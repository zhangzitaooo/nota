import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { command, assetUrl } from "./api";
import { Icon } from "./Icon";
import { PaperBlock, anchorFromSelection } from "./Reader";
import { ReaderOutline } from "./ReaderOutline";
import { MarginCard } from "./ReaderNotes";
import { CommentPopover } from "./CommentPopover";
import { useReadingPosition } from "./useReadingPosition";
import { AgentSetup } from "./AgentSetup";
import { ImportDialog } from "./ImportDialog";
import { LibraryHome } from "./LibraryHome";
import { AgentPanel } from "./AgentPanel";
import { ReadingAppearance, useReadingAppearance } from "./ReadingAppearance";
import type { CSSProperties } from "react";
import { anchorKey } from "./types";
import type { Anchor, Annotation, Block, Snapshot } from "./types";

function ReaderEnding() {
  const [revealed, setRevealed] = useState(false);
  return <footer className="page-footer">
    <button className="reader-signoff" type="button" aria-label="和 Nota 打招呼" aria-expanded={revealed}
      onClick={() => setRevealed(value => !value)}>
      <img src="/assets/nota-agent-builtin.png" width="28" height="28" alt="" />
      <span aria-live="polite">{revealed ? "我就知道，你会翻到这里。" : "全文完"}</span>
    </button>
  </footer>;
}

export default function Workbench() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [home, setHome] = useState(true);
  const [agentSetup, setAgentSetup] = useState(false);
  const [opening, setOpening] = useState(false);
  const [panel, setPanel] = useState<"agent" | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  function addAnchor(anchor: Anchor) {
    const key = anchorKey(anchor);
    setAnchors(current => current.some(item => anchorKey(item) === key) ? current : [...current, anchor]);
  }
  // A transient browser selection is not an Agent/composer reference until an
  // action is chosen. Merely selecting must never focus the Agent input.
  const [toolbar, setToolbar] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<Range | null>(null);
  const appearance = useReadingAppearance();
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const drafts = useRef(new Map<string, string>());
  const [noteError, setNoteError] = useState("");
  const [commentAnchor, setCommentAnchor] = useState<Anchor | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Block | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLElement>(null);
  const currentPaper = useRef("");
  const raise = useCallback((e: Error) => setError(e.message), []);
  const { mode, changeMode, goTo, onScroll, flush, preserveLayout } = useReadingPosition(
    reader,
    state,
    raise,
    !home,
  );
  const closeComments = useCallback(() => {
    setFocused(null);
    setNoteError("");
    setCommentAnchor(null);
    setCommentTarget(null);
  }, []);
  const dismissSelection = useCallback(() => {
    setToolbar(null);
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if ((event.target as Element).closest(".selection-toolbar")) return;
      dismissSelection();
    };
    const changed = () => {
      if (!window.getSelection()?.toString().trim()) dismissSelection();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("selectionchange", changed);
    window.addEventListener("resize", dismissSelection);
    window.addEventListener("blur", dismissSelection);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("selectionchange", changed);
      window.removeEventListener("resize", dismissSelection);
      window.removeEventListener("blur", dismissSelection);
    };
  }, [dismissSelection]);
  useEffect(() => {
    if (!focused) return;
    const clearOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(".reader-margin-card");
      if ((card && (event.type === "click" || card.id === "reader-note-" + focused)) ||
          target.closest("[data-note-id]")?.getAttribute("data-note-id") === focused ||
          target.closest(".margin-note")) return;
      setFocused(null);
    };
    const afterTab = (event: KeyboardEvent) => {
      if (event.key === "Tab") clearOutside(event);
    };
    // Wait for the click so collapsing a thread cannot move the next pointer target.
    document.addEventListener("click", clearOutside, true);
    document.addEventListener("keyup", afterTab);
    return () => {
      document.removeEventListener("click", clearOutside, true);
      document.removeEventListener("keyup", afterTab);
    };
  }, [focused]);
  const notesByBlock = useMemo(() => {
    const result = new Map<string, Annotation[]>();
    for (const note of state?.annotations || []) {
      for (const part of [note, ...(note.continuation || [])]) {
        const notes = result.get(part.blockId) || [];
        notes.push({ ...note, ...part });
        result.set(part.blockId, notes);
      }
    }
    return result;
  }, [state?.annotations]);
  const sections = useMemo(() => {
    const paper = state?.paper;
    if (!paper) return [];
    const translated = new Map<string, string[]>();
    if (mode !== "en") {
      for (const segment of state?.translation?.segments || []) {
        const parts = translated.get(segment.blockId) || [];
        parts.push(segment.zh || segment.source);
        translated.set(segment.blockId, parts);
      }
    }
    return paper.blocks
      .filter(b => b.type === "Title" && b.text.trim() && b.text.trim() !== paper.title.trim())
      .map(b => ({ id: b.id, label: translated.get(b.id)?.join(" ") || b.text, nested: /^[A-Z0-9]+\.\d/.test(b.text.trim()) }));
  }, [state?.paper, state?.translation, mode]);
  useEffect(() => {
    const events = new EventSource("/events");
    events.onmessage = (e) => {
      const next: Snapshot = JSON.parse(e.data);
      const doc = reader.current?.querySelector(".document");
      if (currentPaper.current === next.paper.id && reader.current?.clientHeight && doc &&
          doc.classList.contains("with-margin-notes") !== Boolean(next.annotations.length)) {
        preserveLayout(() => setState(next));
      } else {
        setState(next);
      }
      setOnline(true);
      if (currentPaper.current !== next.paper.id) {
        currentPaper.current = next.paper.id;
        setAnchors([]);
        dismissSelection();
        setFocused(null);
        drafts.current.clear();
        setCommentTarget(null);
        setPreview(null);
        setNoteError("");
        setCommentAnchor(null);
      }
    };
    events.onerror = () => setOnline(false);
    return () => events.close();
  }, [preserveLayout]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        dismissSelection();
        window.getSelection()?.removeAllRanges();
        closeComments();
      }
      if (!home && (e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        preserveLayout(() => setPanel((p) => (p === "agent" ? null : "agent")));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [home]);
  useEffect(() => {
    if (preview && !previewDialog.current?.open)
      previewDialog.current?.showModal();
  }, [preview]);
  async function showHome() {
    try {
      await flush();
      const res = await fetch("/api/state");
      if (!res.ok) throw Error("论文库暂时不可用，请重试");
      setState(await res.json());
      setHome(true);
      setPanel(null);
      setToolbar(null);
      setPreview(null);
      closeComments();
    } catch (e) { raise(e as Error); }
  }
  async function openPaper(id: string) {
    if (opening) return;
    setOpening(true);
    try {
      if (!home) await flush();
      const next = await command<Snapshot>("switch", { paperId: id });
      setState(next);
      setHome(false);
      setError("");
    } catch (e) { raise(e as Error); }
    finally { setOpening(false); }
  }
  const orderedNotes = useMemo(() => {
    const order = new Map(state?.paper.blocks.map((b, i) => [b.id, i]));
    return [...(state?.annotations || [])].sort((a, b) =>
      (order.get(a.blockId) ?? Infinity) - (order.get(b.blockId) ?? Infinity) || a.startOffset - b.startOffset);
  }, [state?.paper.blocks, state?.annotations]);
  const cardsByBlock = useMemo(() => {
    const groups = new Map<string, Annotation[]>();
    for (const note of orderedNotes) {
      const group = groups.get(note.blockId) || [];
      group.push(note); groups.set(note.blockId, group);
    }
    return groups;
  }, [orderedNotes]);

  function jump(n: Annotation) {
    closeComments();
    setToolbar(null);
    setFocused(n.annotationId);
    if (window.matchMedia("(max-width: 850px)").matches) setPanel(null);
    requestAnimationFrame(() => {
      goTo(n.blockId, n.segmentId, n.startOffset);
      document.getElementById("reader-note-" + n.annotationId)?.focus({ preventScroll: true });
    });
  }
  async function run(name: string, body: unknown = {}) {
    try {
      setError("");
      return await command(name, body);
    } catch (e) {
      raise(e as Error);
    }
  }
  function reference(b: Block) {
    if (!state) return;
    addAnchor({
      paperId: state.paper.id,
      documentVersion: state.paper.version,
      blockId: b.id,
      page: b.page,
      selectedText: b.text || "[图表]",
      startOffset: 0,
      endOffset: b.text.length,
      language: "en",
    });
    setToolbar(null);
    preserveLayout(() => setPanel("agent"));
  }
  function selected(event: { target: EventTarget | null }) {
    if (!state) return;
    if ((event.target as Element).closest("button, select, input, textarea, a")) return;
    dismissSelection();
    const result = anchorFromSelection(state.paper, state.translation);
    if (result) setToolbar(result);
  }
  async function saveNote(kind: "comment" | "highlight", target = commentAnchor) {
    if (!target || saving) return;
    setSaving(true);
    try {
      const saved = await command<Annotation>("annotations", {
        ...target,
        kind,
        body: kind === "highlight" ? "" : comment,
      });
      if (currentPaper.current !== target.paperId) return;
      if (kind === "comment") drafts.current.delete(anchorKey(target));
      setFocused(kind === "comment" ? saved.annotationId : null);
      setCommentTarget(null);
      setToolbar(null);
      setNoteError("");
      setCommentAnchor(null);
      setComment("");
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      if (kind === "comment") setNoteError((e as Error).message);
      else raise(e as Error);
    } finally {
      setSaving(false);
    }
  }
  if (!state)
    return (
      <div className="boot-screen">
        <Icon name="book" size={32} />
        <p>{online ? "正在打开论文…" : "正在连接本机工作台…"}</p>
      </div>
    );
  const { paper, translation: t, importJob: job } = state;
  const hasPaper = !!paper.parser;
  const jobVisible = job && job.status !== "completed";
  const translateBusy = state.translationActive === paper.id;
  const translated = t?.status === "completed";
  const firstBlock = paper.blocks[0];
  const coverTitle = firstBlock?.type === "Title" && firstBlock.text.trim().toLowerCase() === paper.title.trim().toLowerCase();
  const abstractIndex = paper.blocks.findIndex(b => b.type === "Title" && /^(abstract|摘要)$/i.test(b.text.trim()));
  const bylineCount = coverTitle && abstractIndex > 0 && abstractIndex <= 8 ? abstractIndex - 1 : 0;
  function jumpSection(id: string) {
    goTo(id);
    dismissSelection();
    closeComments();
  }
  function renderBlock(b: Block, className?: string) {
    const cards = cardsByBlock.get(b.id);
    const blockNotes = notesByBlock.get(b.id) || [];
    const block = <PaperBlock className={className}
      key={paper.id + b.id} block={b} paper={paper} translation={t} mode={mode}
      notes={blockNotes} onPreview={setPreview} onReference={reference}
      activeNote={focused}
      onNotes={id => {
        const original = orderedNotes.find(n => n.annotationId === id);
        if (original && original.blockId !== b.id) jump(original);
        else setFocused(id);
      }}
    />;
    return <div className={cards ? "reader-annotated-row" : "reader-plain-row"} key={paper.id + b.id}>
      {block}
      {cards && <aside className="reader-margin-notes" aria-label="段落批注">
        {cards.map(n => <MarginCard key={n.annotationId} note={n} paperId={paper.id} active={focused === n.annotationId}
          onSelect={() => setFocused(n.annotationId)} onDismiss={() => setFocused(null)} onPreview={() => setPreview(b)} />)}
      </aside>}
    </div>;
  }
  return (
    <div
      className={`workbench ${home ? "is-home" : ""} ${panel ? "panel-open" : ""}`}
    >
      {!home && <header className="topbar">
        <div className="breadcrumb">
          <button
            className="home-logo"
            aria-label="Nota 首页"
            title="返回首页"
            onClick={() => void showHome()}
          >
            <img src="/assets/nota-agent-builtin.png" alt="" width="22" height="22" /><span>论文库</span>
          </button>
          {hasPaper && <span className="crumb-title">{paper.title}</span>}
        </div>
        <div className="top-actions">
          {!online && <span className="offline">服务重连中</span>}
          {hasPaper && !home && (
            <>
              <button
                className={`agent-toggle ${panel === "agent" ? "active" : ""}`}
                onClick={() =>
                  preserveLayout(() => setPanel((p) => (p === "agent" ? null : "agent")))
                }
                aria-expanded={panel === "agent"}
                aria-label={panel === "agent" ? "隐藏 Agent" : "打开 Agent"}
              >
                <Icon name="chat" />
                <span>Agent</span>
                {state.busy && <i className="pulse-dot" />}
              </button>
            </>
          )}
        </div>
      </header>}
      {home && <LibraryHome state={state} opening={opening} error={error || state.error || ""}
        onOpen={(id) => void openPaper(id)} onImport={() => setImportOpen(true)}
        onTask={(action) => void run(action)} onAgent={() => setAgentSetup(true)} onDismissError={() => setError("")} />}
      <main
        style={home ? { display: "none" } : undefined}
        className="reader"
        ref={reader}
        onMouseUp={selected}
        onKeyUp={(event) => {
          if (event.key === "Shift" || event.key.startsWith("Arrow")) selected(event);
        }}
        onScroll={() => {
          dismissSelection();
          onScroll();
        }}
      >
        {(error || state.error) && (
          <div className="error-banner" role="alert">
            <span>{error || state.error}</span>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              {error && <Icon name="close" size={15} />}
            </button>
          </div>
        )}
        {jobVisible && (
          <div className="task-banner" role="status">
            <div>
              <strong>{job.name}</strong>
              <p>
                {job.detail || "准备解析"}
                {job.error ? " · " + job.error : ""}
              </p>
            </div>
            {job.busy ? (
              <button onClick={() => run("import/pause")}>暂停解析</button>
            ) : (
              <button onClick={() => run("import/resume")}>继续解析</button>
            )}
          </div>
        )}
        {!hasPaper ? (
          <div className="welcome">
            <div className="welcome-icon">
              <Icon name="book" size={42} />
            </div>
            <h1>Nota</h1>
            <p>把论文读懂，把思考留下</p>
            <button
              className="primary"
              onClick={() => setImportOpen(true)}
              disabled={!!job?.busy}
            >
              <Icon name="plus" />
              导入 PDF 论文
            </button>
            <small>OXR 图文解析 · 连接你自己的 Codex</small>
            {state.library.length > 0 && (
              <button onClick={() => void showHome()}>
                继续阅读已有论文 →
              </button>
            )}
          </div>
        ) : (
          <div className={`reader-layout ${sections.length ? "with-outline" : ""}`}>
            {sections.length > 0 && <ReaderOutline sections={sections} reader={reader} onJump={jumpSection} />}
          <div className={`document ${cardsByBlock.size ? "with-margin-notes" : ""}`} data-reading-mode={mode} style={{ "--reading-size": `${appearance.value.size}px`, "--reading-width": `${appearance.value.width}px`, "--reading-spacing": appearance.value.spacing } as CSSProperties}>
            <header className="document-header">
              {coverTitle ? renderBlock(firstBlock, "cover-title") : <h1>{paper.title}</h1>}
              <div className="document-meta">
                <a
                  href={assetUrl(paper.id, "original.pdf")}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看原 PDF <Icon name="source" size={12} />
                </a>
              </div>
            </header>
            <div className="reading-toolbar">
              <div className="reading-modes" aria-label="阅读语言">
                {(["zh", "bilingual", "en"] as const).map((v) => (
                  <button
                    aria-pressed={mode === v}
                    className={mode === v ? "selected" : ""}
                    key={v}
                    onClick={() => {
                      changeMode(v);
                      setToolbar(null);
                    }}
                  >
                    {v === "zh" ? "中文" : v === "en" ? "English" : "中英对照"}
                  </button>
                ))}
              </div>
              {!translated && <button className="translation-action" disabled={!translateBusy && (!!state.translationActive || !!job?.busy)}
                title={t?.error || (translateBusy ? "暂停翻译" : "翻译为中文")}
                onClick={() => run(translateBusy ? "translate/pause" : "translate")}>
                {translateBusy ? <><i className="pulse-dot" />翻译中</> : t?.status === "failed" ? "重试翻译" : t ? "继续翻译" : "翻译"}
              </button>}
              <div className="reading-navigation">
              <ReadingAppearance value={appearance.value} onChange={next => preserveLayout(() => appearance.update(next))} />
              {sections.length > 0 && <label className="section-picker">
                <Icon name="menu" size={16} />目录
                <select value="" aria-label="章节目录" onChange={e => {
                  jumpSection(e.target.value);
                }}>
                  <option value="" disabled>跳转到章节</option>
                  {sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
                </select>
              </label>}
              </div>
            </div>
            {paper.blocks.slice(coverTitle ? 1 : 0).map((b, i) => renderBlock(b, i < bylineCount ? "paper-byline" : undefined))}
            <ReaderEnding key={paper.id} />
          </div>
          </div>
        )}
      </main>
      {!home && panel === "agent" && hasPaper && (
        <AgentPanel
          key={state.paper.id + state.activeConversationId}
          state={state}
          anchors={anchors}
          onRemove={anchor => setAnchors(current => current.filter(item => item !== anchor))}
          onUseAnchors={setAnchors}
          onState={setState}
          onPreview={setPreview}
          onLocate={(a) => { goTo(a.blockId, a.segmentId, a.startOffset); setToolbar(null); }}
          onSettings={() => setAgentSetup(true)}
          onClose={() => preserveLayout(() => setPanel(null))}
          onResize={preserveLayout}
        />
      )}
      {toolbar && (
        <div
          className="selection-toolbar chat-selection-actions"
          role="toolbar"
          aria-label="选区操作"
          style={{ left: toolbar.x, top: toolbar.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={() => {
              addAnchor(toolbar.anchor);
              preserveLayout(() => setPanel("agent"));
              setToolbar(null);
            }}
          >
            <Icon name="chat" size={15} />问 Agent
          </button>
          <button disabled={saving} onClick={() => saveNote("highlight", toolbar.anchor)}>
            <Icon name="highlight" size={15} />
            高亮
          </button>
          <button
            onClick={() => {
              setCommentAnchor(toolbar.anchor);
              setCommentTarget(window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null);
              setComment(drafts.current.get(anchorKey(toolbar.anchor)) || "");
              setNoteError("");
              setToolbar(null);
            }}
          >
            <Icon name="note" size={15} />
            批注
          </button>
        </div>
      )}
      {agentSetup && <AgentSetup state={state} onClose={() => setAgentSetup(false)} onConnected={setState} />}
      {importOpen && <ImportDialog blocked={!!job?.busy || state.busy || state.connection === "connecting"}
        onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setError(""); }} />}
      {commentAnchor && commentTarget && <CommentPopover reader={reader} target={commentTarget} value={comment}
        saving={saving} error={noteError} onClose={closeComments} onSave={() => void saveNote("comment")}
        onChange={value => {
          setComment(value);
          if (value) drafts.current.set(anchorKey(commentAnchor), value);
          else drafts.current.delete(anchorKey(commentAnchor));
        }} />}
      <dialog
        className="source-dialog"
        ref={previewDialog}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <>
            <header>
              <div>
                <strong>原 PDF · 第 {preview.page} 页</strong>
                <small>橙色框对应当前图文块</small>
              </div>
              <button
                aria-label="关闭原页"
                onClick={() => {
                  previewDialog.current?.close();
                  setPreview(null);
                }}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="source-image">
              <img
                src={assetUrl(paper.id, `page-${preview.page}.png`)}
                alt={`PDF 原文第 ${preview.page} 页`}
              />
              {preview.bbox && preview.pageSize && (
                <div
                  className="source-box"
                  style={{
                    left: (preview.bbox[0] / preview.pageSize.w) * 100 + "%",
                    top: (preview.bbox[1] / preview.pageSize.h) * 100 + "%",
                    width:
                      ((preview.bbox[2] - preview.bbox[0]) /
                        preview.pageSize.w) *
                        100 +
                      "%",
                    height:
                      ((preview.bbox[3] - preview.bbox[1]) /
                        preview.pageSize.h) *
                        100 +
                      "%",
                  }}
                />
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
