import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export function createImporter(root, dataDir, notify, activate) {
  const papersDir = join(dataDir, "papers");
  mkdirSync(papersDir, { recursive: true });
  const python =
    process.env.PAPER_PYTHON || resolve(root, "../.venv/bin/python");
  const jobFile = join(dataDir, "import-job.json");
  let job = existsSync(jobFile) ? JSON.parse(readFileSync(jobFile)) : null;
  if (job?.busy) {
    job.busy = false;
    job.status = "paused";
    job.detail = "解析已暂停，点击继续将复用已完成批次";
  }
  let stopping = false;
  let workerProcess = null;
  const save = (file, value) => {
    writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
    renameSync(file + ".tmp", file);
  };
  function update(v) {
    job = { ...job, ...v };
    save(jobFile, job);
    notify();
  }
  function worker(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(python, ["-B", join(root, "pdf_worker.py"), ...args]);
      workerProcess = p;
      let out = "",
        err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.on("error", reject);
      p.on("exit", (code) =>
        code
          ? reject(Error(err.trim().split("\n").at(-1)))
          : resolve(JSON.parse(out)),
      );
    });
  }
  const base = process.env.OXR_BASE_URL || "https://free-oxr.somark.cn/api/v1";
  async function post(route, form) {
    const r = await fetch(base + route, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw Error(`OXR HTTP ${r.status}`);
    const d = await r.json();
    if (d.code !== 0) throw Error(d.message || "OXR 解析失败");
    return d;
  }
  const statusText = () =>
    `${job.batches.filter((b) => b.status === "completed").length}/${job.batches.length} 批已完成`;
  async function run() {
    stopping = false;
    update({ busy: true, status: "preparing", error: null });
    const dir = join(papersDir, job.id);
    try {
      if (!job.batches?.length) {
        const meta = await worker(["prepare", dir, job.pages]);
        update({ batches: meta.batches, totalPages: meta.pages.length });
      }
      for (const batch of job.batches) {
        if (stopping) throw Error("已暂停");
        const resultFile = join(dir, `batch-${batch.index}-oxr.json`);
        if (existsSync(resultFile)) {
          batch.status = "completed";
          continue;
        }
        if (!batch.taskId) {
          update({
            status: "uploading",
            detail: `${statusText()} · 提交原第 ${batch.pages[0]}–${batch.pages.at(-1)} 页`,
          });
          const f = new FormData();
          f.set(
            "file",
            new Blob([readFileSync(join(dir, batch.file))], {
              type: "application/pdf",
            }),
            batch.file,
          );
          f.set("api_key", "dummy");
          f.set("output_formats", "json");
          f.set(
            "element_formats",
            JSON.stringify({ image: "url", table: "html", formula: "latex" }),
          );
          const submitted = await post("/parse/async", f);
          batch.taskId = submitted.data.task_id;
          if (!batch.taskId) throw Error("OXR 未返回任务 ID");
          batch.status = "submitted";
          update({ batches: job.batches });
        }
        const deadline = Date.now() + 600000;
        let response;
        while (Date.now() < deadline) {
          if (stopping) throw Error("已暂停");
          const f = new FormData();
          f.set("api_key", "dummy");
          f.set("task_id", batch.taskId);
          response = await post("/parse/async_check", f);
          const status = response.data.status;
          batch.status = status;
          update({
            status: "parsing",
            detail: `${statusText()} · 原第 ${batch.pages[0]}–${batch.pages.at(-1)} 页：${status}`,
          });
          if (status === "SUCCESS") break;
          if (["FAILED", "FAILURE", "ERROR", "CANCELLED"].includes(status)) {
            batch.taskId = null;
            throw Error(response.data.error || response.message || status);
          }
          await new Promise((r) => setTimeout(r, 2500));
        }
        if (response?.data.status !== "SUCCESS")
          throw Error("该批等待超过 10 分钟，可点击继续查询");
        response.receivedAt = new Date().toISOString();
        save(resultFile, response);
        batch.status = "completed";
        update({ batches: job.batches, detail: statusText() });
      }
      if (stopping) throw Error("已暂停");
      update({ status: "assembling", detail: "校验全部页码、合并图文并保存" });
      await worker(["assemble", dir]);
      const paper = JSON.parse(readFileSync(join(dir, "paper.json")));
      paper.fileName = job.name;
      save(join(dir, "paper.json"), paper);
      await activate(paper);
      update({
        busy: false,
        status: "completed",
        detail: `已解析 ${paper.pages.length} 页 · ${paper.blocks.length} 个块 · ${job.batches.length} 批`,
        completedAt: new Date().toISOString(),
      });
    } catch (e) {
      update({
        busy: false,
        status: stopping ? "paused" : "failed",
        error: stopping ? null : e.message,
        detail: "已完成批次已保留，可继续；已有论文未替换",
      });
    }
  }
  return {
    get job() {
      return job;
    },
    papersDir,
    library() {
      return readdirSync(papersDir)
        .filter((id) => existsSync(join(papersDir, id, "paper.json")))
        .map((id) => {
          const p = JSON.parse(readFileSync(join(papersDir, id, "paper.json")));
          return { id, title: p.title, pages: p.pages, fileName: p.fileName, sourcePages: p.sourcePages, version: p.version, parser: p.parser, importedAt: statSync(join(papersDir, id, "paper.json")).mtime.toISOString() };
        });
    },
    start(pdf, name, pages) {
      if (job?.busy) throw Error("已有解析任务");
      const id = "paper-" + randomUUID();
      mkdirSync(join(papersDir, id));
      writeFileSync(join(papersDir, id, "original.pdf"), pdf);
      job = {
        id,
        name,
        pages,
        batches: [],
        busy: false,
        startedAt: new Date().toISOString(),
      };
      void run();
      return job;
    },
    resume() {
      if (job?.busy || !job?.id || job.status === "completed")
        throw Error("无待恢复任务");
      void run();
      return job;
    },
    pause() {
      stopping = true;
      workerProcess?.kill();
    },
    close() {
      stopping = true;
      workerProcess?.kill();
    },
  };
}
