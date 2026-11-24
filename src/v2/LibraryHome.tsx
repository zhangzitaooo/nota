import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { assetUrl } from "./api";
import { LibraryMascot } from "./LibraryMascot";
import { Icon } from "./Icon";
import type { ImportJob, LibraryPaper, Snapshot } from "./types";

function paperTitle(paper: LibraryPaper) {
  return paper.title || paper.fileName || "未命名论文";
}
type Activity = { label: string; progress?: number; busy: boolean; warning?: boolean; detail?: string; action?: string; actionLabel?: string };
function activity(p: LibraryPaper, job: ImportJob | null): Activity | null {
  if (job?.id === p.id && job.status !== "completed") {
    const total = job.batches.length;
    const done = job.batches.filter(b => b.status === "completed").length;
    const paused = job.status === "paused", failed = job.status === "failed";
    return { label: paused ? "解析已暂停" : failed ? "解析失败" : "解析中……",
      progress: total ? done / total : undefined, busy: job.busy, warning: paused || failed,
      detail: failed ? job.error : undefined,
      action: job.busy ? "import/pause" : "import/resume",
      actionLabel: job.busy ? "暂停解析" : failed ? "重试解析" : "继续解析" };
  }
  const t = p.translation;
  if (t && t.status !== "completed") return {
    label: t.status === "running" ? "翻译中……" : t.status === "failed" ? "翻译失败" : "翻译已暂停",
    progress: t.total ? t.completed / t.total : undefined, busy: t.status === "running", warning: t.status !== "running",
    detail: t.status !== "running" ? "打开论文后可继续翻译" : undefined,
  };
  return null;
}
function RingGraphic({ fraction, spinning = false }: { fraction: number; spinning?: boolean }) {
  return <svg className={spinning ? "ring-spinning" : undefined} width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle className="ring-track" cx="10" cy="10" r="7.5" />
    <circle className="ring-fill" cx="10" cy="10" r="7.5" pathLength="100" strokeDasharray={`${fraction * 100} 100`} transform="rotate(-90 10 10)" />
  </svg>;
}
function ProgressRing({ value, onTask }: { value: Activity; onTask: (action: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = expanded || hovered;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!visible || !root.current || !popover.current) return;
    const rect = root.current.getBoundingClientRect(), height = popover.current.offsetHeight;
    setPosition({ left: Math.max(12, Math.min(rect.left - 12, window.innerWidth - 252)), top: rect.bottom + height + 16 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8) });
  }, [visible, value.label, value.detail]);
  useEffect(() => {
    if (!visible) return;
    const close = () => { setExpanded(false); setHovered(false); };
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); root.current?.querySelector('button')?.focus({ preventScroll: true }); } };
    const scroll = (e: Event) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); };
  }, [visible]);
  return <span ref={root} className={`paper-activity ${value.warning ? "is-warning" : ""} ${visible ? "is-expanded" : ""}`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setExpanded(false); setHovered(false); } }}>
    <button className="activity-trigger" aria-label={value.label} aria-expanded={visible} onClick={() => { if (expanded) { setExpanded(false); setHovered(false); } else setExpanded(true); }}>
      <RingGraphic fraction={Math.max(.05, value.progress ?? .22)} spinning={value.busy && !value.progress} />
    </button>
    {visible && <span ref={popover} className="activity-tooltip" role="group" aria-label="处理状态" style={{ left: position?.left, top: position?.top, visibility: position ? 'visible' : 'hidden' }}><strong>{value.label}</strong>{value.detail && <span>{value.detail}</span>}{value.action && <button onClick={() => { onTask(value.action!); setExpanded(false); setHovered(false); }}>{value.actionLabel}</button>}</span>}
  </span>;
}

export function LibraryHome({ state, opening, error, onOpen, onImport, onTask, onAgent, onDismissError }: {
  state: Snapshot; opening: boolean; error: string;
  onOpen: (id: string) => void; onImport: () => void; onTask: (action: string) => void;
  onAgent: () => void; onDismissError: () => void;
}) {
  const { library, importJob: job } = state;
  const recent = library.find(p => p.lastReadAt || p.readingPosition);
  const featured = recent || library[0];
  const featureLabel = recent ? "继续阅读" : "最近导入";
  const blocked = opening || state.busy || !!job?.busy || state.connection === "connecting";
  const rows: LibraryPaper[] = job && job.status !== "completed" && !library.some(p => p.id === job.id)
    ? [{ id: job.id, title: job.name.replace(/\.pdf$/i, ""), pages: [], importedAt: "", lastReadAt: null, readingPosition: null, translation: null }, ...library] : library;
  const titleCounts = new Map<string, number>();
  for (const row of rows) {
    const title = paperTitle(row).trim().toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
  }
  const firstVisit = rows.length === 0;
  return <main className={`library-home ${firstVisit ? "first-visit" : ""}`} aria-label={firstVisit ? "首次使用引导" : "论文库首页"}>
    <div className="home-document">
      <header className="library-masthead">
        <span className="nota-wordmark"><LibraryMascot />Nota</span>
        <div className="library-tools">
          {!firstVisit && <button className="home-import" onClick={onImport} disabled={blocked}><Icon name="plus" size={16} />导入论文</button>}
          <button className="library-settings" aria-label="设置" title="设置" onClick={onAgent}><Icon name="settings" size={22} /></button>
        </div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={onDismissError}><Icon name="close" size={15} /></button></div>}
      {firstVisit ? <section className="onboarding" aria-label="开始使用">
        <div className="library-welcome"><h1>打开你的第一篇论文</h1><p>粘贴论文链接，或上传 PDF。</p><button className="home-import" onClick={onImport} disabled={blocked}><Icon name="plus" size={16} />导入论文</button></div>
        <div className="onboarding-step"><span className="onboarding-icon"><Icon name="chat" size={23} /></span><div><h2>选择阅读助手</h2><p>使用 Nota Agent，或连接本机 Agent。</p></div><button className="onboarding-secondary" onClick={onAgent}>设置 Agent</button></div>
      </section> : <>
        {featured && <section className="reading-feature" aria-label={featureLabel}>
          <div className="feature-copy">
            <span className="feature-label"><Icon name="book" size={15} />{featureLabel}</span>
            <h2>{featured.title || featured.fileName}</h2>
            <button className="feature-resume" onClick={() => onOpen(featured.id)} disabled={blocked}>{recent ? "接着读" : "开始阅读"}<Icon name="chevron" size={15} /></button>
          </div>
          {featured.pages.length > 0 && <div className="feature-art" aria-hidden="true">
            <div className="feature-sheet"><img key={featured.id} alt="" src={assetUrl(featured.id, `page-${featured.pages[0]}.png`)} /></div>
          </div>}
        </section>}
        <section className="home-recent" aria-labelledby="recent-heading">
          <header><h1 id="recent-heading">我的论文 <span>{rows.length}</span></h1></header>
          <ul className="home-paper-list">{rows.map(p => {
            const progress = activity(p, job);
            const available = library.some(ready => ready.id === p.id);
            const title = paperTitle(p);
            const repeated = (titleCounts.get(title.trim().toLowerCase()) || 0) > 1;
            const edition = repeated && p.fileName?.match(/\d{4}\.\d{4,5}(v\d+)/i)?.[1];
            return <li key={p.id} className="home-paper-row">
              <span className="home-paper-name"><Icon name="file" size={18} />
                <span className="home-title-line"><button title={[title, p.fileName].filter(Boolean).join(" · ")} aria-label={`打开 ${title}${edition ? " " + edition : ""}`} disabled={blocked || !available} onClick={() => onOpen(p.id)}>
                  {title}{edition && <small className="paper-edition">{edition}</small>}
                </button>{progress && <ProgressRing value={progress} onTask={onTask} />}</span>
              </span>
              <span className="paper-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>
            </li>;
          })}</ul>
        </section>
      </>}
    </div>
  </main>;
}
