import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { validateReadingPosition } from "../server/reading.mjs";
import { mathTokens } from "../src/v2/math.ts";
import { randomUUID } from "node:crypto";
import { turnContext } from "../server/paper-environment.mjs";
import { validateAnchor } from "../server/anchors.mjs";
import { segmentsFor } from "../server/translation.mjs";

const paper = {
  id: "paper-aaaa-1234",
  version: 1,
  title: "Test paper",
  parser: "OXR",
  sourcePages: 2,
  pages: [1, 2],
  blocks: [
    {
      id: "p1-b0",
      page: 1,
      type: "Text",
      text: "First sentence. The result is 4x better.",
    },
    { id: "p2-b0", page: 2, type: "Picture", asset: "p2-b0.png", text: "" },
  ],
};
const segments = segmentsFor(paper);
segments[1].zh = "结果好 4 倍。";
const translation = {
  version: 1,
  segments,
  status: "completed",
  completed: 2,
  total: 2,
};
const anchor = {
  paperId: paper.id,
  documentVersion: 1,
  blockId: "p1-b0",
  language: "zh",
  segmentId: segments[1].id,
  translationVersion: 1,
  selectedText: segments[1].source,
  startOffset: segments[1].start,
  endOffset: segments[1].end,
  translatedText: "4 倍",
  translationStart: 4,
  translationEnd: 7,
};
test("Chinese anchors preserve English sentence and reject stale/forged offsets", () => {
  const a = validateAnchor(anchor, paper, translation);
  assert.equal(a.page, 1);
  assert.equal(a.alignment, "sentence");
  for (const bad of [
    { paperId: "other" },
    { documentVersion: 2 },
    { translationVersion: 2 },
    { segmentId: "wrong" },
    { startOffset: 0 },
    { endOffset: 1000 },
    { translatedText: "made up" },
    { translationStart: 0 },
    { language: "oops" },
  ])
    assert.throws(() =>
      validateAnchor({ ...anchor, ...bad }, paper, translation),
    );
});
test("a mixed-language excerpt validates and reaches the agent in reading order", () => {
  const lead = { paperId: paper.id, documentVersion: paper.version, blockId: "p1-b0",
    selectedText: "First", startOffset: 0, endOffset: 5, language: "en" };
  const selection = validateAnchor({ ...lead, continuation: [anchor] }, paper, translation);
  const context = JSON.parse(turnContext(paper, selection, null)).selection;
  assert.equal(context.original, "First");
  assert.equal(context.continuation[0].translated, "4 倍");
  assert.throws(() => validateAnchor({ ...lead, continuation: [{ ...anchor, translatedText: "other" }] }, paper, translation));
});

test("Unicode/repeated sentences retain complete original character coverage", () => {
  const b = {
    id: "unicode",
    page: 1,
    type: "Text",
    text: "😀 Start. Same sentence. Same sentence. " + "word ".repeat(600),
  };
  const parts = segmentsFor({ blocks: [b] });
  let cursor = 0;
  for (const s of parts) {
    assert.equal(b.text.slice(s.start, s.end), s.source);
    assert(!b.text.slice(cursor, s.start).trim());
    cursor = s.end;
  }
  assert(!b.text.slice(cursor).trim());
  assert.equal(new Set(parts.map((s) => s.id)).size, parts.length);
});
test("image-only anchors cannot forge text offsets", () => {
  const image = {
    paperId: paper.id,
    documentVersion: 1,
    blockId: "p2-b0",
    selectedText: "[图表]",
    startOffset: 0,
    endOffset: 0,
  };
  assert.equal(validateAnchor(image, paper, null).page, 2);
  assert.throws(() => validateAnchor({ ...image, endOffset: 1 }, paper, null));
});

test("HTTP writes, origin guards, and restart preserve the actual saved annotation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-v2-test-"));
  const papers = join(dir, "papers", paper.id);
  mkdirSync(papers, { recursive: true });
  writeFileSync(join(papers, "paper.json"), JSON.stringify(paper));
  writeFileSync(join(papers, "translation.json"), JSON.stringify(translation));
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      paper,
      threadId: null,
      messages: [],
      annotations: [],
      requests: [],
      stats: { deltas: 0, saves: 0, resumes: 0 },
      events: [],
    }),
  );
  let child;
  async function start() {
    child = spawn(process.execPath, ["server/server.mjs"], {
      cwd: resolve(import.meta.dirname, ".."),
      env: { ...process.env, PAPER_DATA_DIR: dir, PORT: "0" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let log = "";
    child.stderr.on("data", (b) => (log += b));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error(log || "start timeout")),
        10000,
      );
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error(log || "early exit"));
      });
      child.on("message", (m) => {
        if (m.type === "ready") {
          clearTimeout(timer);
          resolve("http://127.0.0.1:" + m.port);
        }
      });
    });
  }
  async function stop() {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  try {
    let base = await start();
    const post = (body, headers = {}) =>
      fetch(base + "/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const body = {
      ...anchor,
      kind: "comment",
      body: "Check efficiency against the baseline.",
    };
    assert.equal(
      (await post(body, { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal((await post({ ...body, translationVersion: 99 })).status, 400);
    assert.equal((await post({ ...body, body: "" })).status, 400);
    const created = await post(body);
    assert.equal(created.status, 201);
    const note = await created.json();
    assert.equal(note.author, "user");
    assert.equal(note.selectedText, segments[1].source);
    const disk = JSON.parse(readFileSync(join(dir, "state.json")));
    assert.deepEqual(disk.annotations, [note]);
    assert.equal(
      (await fetch(base + "/papers/" + paper.id + "/state.json")).status,
      404,
    );
    const clientId = randomUUID();
    const position = {
      paperId: paper.id,
      documentVersion: 1,
      blockId: "p1-b0",
      page: 1,
      sourceOffset: segments[1].start,
      segmentId: segments[1].id,
      progress: 0.4,
      viewportOffset: 92,
      mode: "bilingual",
      atTop: false,
    };
    const savePosition = (position, sequence) =>
      fetch(base + "/api/reading-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position, clientId, sequence }),
      });
    assert.equal(
      (await savePosition({ ...position, documentVersion: 9 }, 1)).status,
      400,
    );
    assert.equal(
      (await savePosition({ ...position, blockId: "missing" }, 1)).status,
      400,
    );
    assert.equal((await savePosition(position, 2)).status, 200);
    assert.deepEqual(
      await (await savePosition({ ...position, progress: 0.1 }, 1)).json(),
      { stale: true },
    );
    await stop();
    base = await start();
    const resumed = await (await fetch(base + "/api/state")).json();
    assert.deepEqual(resumed.annotations, [note]);
    assert.deepEqual(resumed.paper, paper);
    assert.deepEqual(resumed.readingPosition, position);
    assert.deepEqual(resumed.library[0].readingPosition, position);
    assert.equal(resumed.library[0].translation.status, "completed");
    assert.equal(resumed.library[0].sourcePages, 2);
    assert(!Number.isNaN(Date.parse(resumed.library[0].lastReadAt)));
    // Opening the active paper must not reset its annotations or reading anchor.
    const opened = await fetch(base + "/api/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId: paper.id }),
    });
    assert.equal(opened.status, 200);
    const openedState = await opened.json();
    assert.deepEqual(openedState.annotations, [note]);
    assert.deepEqual(openedState.readingPosition, position);
    const second = { ...paper, id: "paper-bbbb-5678", title: "Another paper" };
    mkdirSync(join(dir, "papers", second.id));
    writeFileSync(join(dir, "papers", second.id, "paper.json"), JSON.stringify(second));
    const switchTo = async (id) => (await fetch(base + "/api/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId: id }),
    })).json();
    const other = await switchTo(second.id);
    assert.equal(other.library[0].id, second.id);
    assert.equal(other.readingPosition, null);
    const back = await switchTo(paper.id);
    assert.equal(back.library[0].id, paper.id);
    assert.deepEqual(back.readingPosition, position);
    assert.deepEqual(back.annotations, [note]);
  } finally {
    if (child?.exitCode === null) await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("math tokens preserve every source offset with inline, display, escaped delimiters and Unicode", () => {
  const source = String.raw`😀 Before $x_1^2$ after \(a+b\). $$\frac{1}{n}\sum_i x_i$$ End \$5.`;
  const tokens = mathTokens(source);
  assert.equal(tokens.map((t) => t.raw).join(""), source);
  assert.equal(tokens.filter((t) => t.tex !== undefined).length, 3);
  for (const t of tokens) assert.equal(source.slice(t.start, t.end), t.raw);
  assert.equal(
    tokens.find((t) => t.display).tex,
    String.raw`\frac{1}{n}\sum_i x_i`,
  );
  assert.equal(
    mathTokens("unclosed $x and text").some((t) => t.tex !== undefined),
    false,
  );
  assert.equal(mathTokens(String.raw`\sum_i x_i`, true)[0].display, true);
});

test("reading positions reject wrong paper, version, segment and non-finite geometry", () => {
  const pos = {
    paperId: paper.id,
    documentVersion: 1,
    blockId: "p1-b0",
    sourceOffset: 0,
    progress: 0,
    viewportOffset: 92,
    mode: "zh",
  };
  assert.equal(validateReadingPosition(pos, paper, translation).page, 1);
  for (const bad of [
    { paperId: "other" },
    { documentVersion: 3 },
    { sourceOffset: 999 },
    { segmentId: "missing" },
    { progress: NaN },
    { progress: -1 },
    { viewportOffset: Infinity },
    { mode: "bad" },
  ])
    assert.throws(() =>
      validateReadingPosition({ ...pos, ...bad }, paper, translation),
    );
});

test("agent readiness distinguishes missing, signed-out and authenticated without exposing login output", async () => {
  const { agentStatus } = await import("../server/agent-status.mjs");
  const dir = mkdtempSync(join(tmpdir(), "paper-agent-test-"));
  try {
    assert.deepEqual(await agentStatus(join(dir, "missing")), { installed: false, signedIn: false });
    const binary = join(dir, "codex-fixture");
    for (const code of [1, 0]) {
      writeFileSync(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'codex-test 1'; exit 0; fi\necho 'private-account-output' >&2\nexit ${code}\n`, { mode: 0o755 });
      const status = await agentStatus(binary);
      assert.deepEqual(status, { installed: true, signedIn: code === 0, version: "codex-test 1" });
      assert(!JSON.stringify(status).includes("private-account-output"));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
