import { useRef, useState } from "react";
import { command, importPdf } from "./api";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export function ImportDialog({ blocked, onClose, onImported }: { blocked: boolean; onClose: () => void; onImported: () => void }) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  function chooseFile(next?: File) {
    if (!next) return;
    if (!/\.pdf$/i.test(next.name) || !next.size) { setError("请选择有效的 PDF 文件"); if (input.current) input.current.value = ""; return; }
    setFile(next); setUrl(""); setError("");
  }
  async function submit() {
    if (inFlight.current || blocked || (!file && !url.trim())) return;
    if (!file) {
      try { const parsed = new URL(url.trim()); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); }
      catch { setError("请粘贴有效的 PDF 或 arXiv 论文链接"); return; }
    }
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (file) await importPdf(file, "all");
      else await command("import/url", { url: url.trim() });
      onImported();
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title="导入一篇论文" label="导入论文" className="import-modal" busy={busy} onClose={onClose}>
    <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
      <div className="import-url-field"><Icon name="link" size={18} /><input data-initial-focus aria-label="论文链接" aria-invalid={!!error && !file} aria-describedby={error ? "import-error" : undefined}
        placeholder="粘贴 PDF 或 arXiv 论文链接" value={url} maxLength={8192} disabled={busy} type="url" autoComplete="off" spellCheck={false}
        onChange={e => { setUrl(e.target.value); setFile(null); if (input.current) input.current.value = ""; setError(""); }} /></div>
      <div className="import-divider" aria-hidden="true"><span>或</span></div>
      <div className={`import-upload ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) chooseFile(e.dataTransfer.files[0]); }}>
        <label><Icon name={file ? "file" : "upload"} size={22} /><span>{file?.name || "上传 PDF 文件"}</span>
          <input ref={input} type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 文件" disabled={busy} onChange={e => chooseFile(e.target.files?.[0])} /></label>
        {file && <button type="button" aria-label="移除文件" disabled={busy} onClick={() => { setFile(null); if (input.current) input.current.value = ""; setError(""); }}><Icon name="close" size={16} /></button>}
      </div>
      {error && <p className="form-error" id="import-error" role="alert">{error}</p>}
      {blocked && <p className="form-notice" role="status">当前任务结束后即可导入</p>}
      <footer><button className="home-import full" disabled={busy || blocked || (!file && !url.trim())}>{busy && <i className="control-spinner" aria-hidden="true" />}{busy ? (file ? "正在导入…" : "正在下载…") : "导入并解析"}</button></footer>
    </form>
  </Modal>;
}
