import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { AboutNota } from "./AboutNota";
import { Modal } from "./Modal";
import { command } from "./api";
import type { Snapshot, Provider } from "./types";

const primaryIds = new Set(["builtin", "codex", "claude", "workbuddy"]);
type LocalAgent = { id: "builtin" | "codex" | "claude" | "workbuddy" | "antigravity" | "deepseek" | "opencode"; name: string; installed: boolean | null; supported: boolean; guide?: string; signedIn: boolean; version?: string; error?: string };
function agentStatusLabel(a: LocalAgent) {
  if (a.error) return "检测失败，请重试";
  if (!a.supported) return a.installed ? "已安装 · 待接入" : "未安装 · 待接入";
  if (!a.installed) return "未安装";
  if (a.id === "builtin") return a.signedIn ? null : "暂未开通";
  if (a.id === "workbuddy") return a.signedIn ? "已配置模型" : "请在 WorkBuddy 中配置自定义模型";
  return a.signedIn ? "已登录" : "需登录";
}
export function AgentSetup({ state, onClose, onConnected }: {
  state: Snapshot; onClose: () => void; onConnected: (next: Snapshot) => void;
}) {
  const [section, setSection] = useState<"agents" | "about">("agents");
  const [saved, setSaved] = useState(false);
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [selected, setSelected] = useState<Provider>(state.settings.defaultAgent);
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  async function check() {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setChecking(true); setError("");
    try {
      const r = await fetch("/api/settings", { signal: controller.signal }); const data = await r.json();
      if (!r.ok) throw Error(data.error || "检测失败，请重试");
      setAgents(data.agents);
      setSelected(current => data.agents.some((a: LocalAgent) => a.id === current) ? current : data.agents.find((a: LocalAgent) => a.supported)?.id || current);
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  useEffect(() => { void check(); return () => pending.current?.abort(); }, []);
  async function apply() {
    if (selected === state.settings.defaultAgent) return;
    setSaving(true); setSaved(false); setError("");
    try { onConnected(await command<Snapshot>("settings/agent", { provider: selected })); setSaved(true); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  function navigate(e: KeyboardEvent<HTMLDivElement>) {
    if (!(e.target instanceof HTMLButtonElement) || e.target.getAttribute("role") !== "radio") return;
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
    if (!buttons.length) return;
    e.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (Math.max(0, index) + (["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); setSaved(false); setSelected(buttons[next].dataset.provider as Provider);
  }
  const chosen = agents.find(a => a.id === selected);
  const unchanged = selected === state.settings.defaultAgent;
  const taskBusy = state.busy || !!state.translationActive || state.connection === "connecting";
  const primary = agents.filter(a => primaryIds.has(a.id));
  const additional = agents.filter(a => !primaryIds.has(a.id));
  const hiddenDefault = additional.find(a => a.id === state.settings.defaultAgent);
  const focusId = !expanded && !primaryIds.has(selected) ? primary.find(a => a.supported)?.id : selected;
  function renderAgent(a: LocalAgent) {
    const status = agentStatusLabel(a);
    return <div key={a.id} className="agent-option"><button data-provider={a.id} role="radio" aria-checked={selected === a.id}
        tabIndex={focusId === a.id ? 0 : -1} disabled={saving || checking || !a.supported} onClick={() => { setSaved(false); setSelected(a.id as Provider); setError(""); }}>
        <span className={`local-agent-symbol provider-${a.id}`}><img alt="" src={`/assets/nota-agent-${a.id}.png`} /></span>
        <span className="local-agent-copy"><strong><span>{a.name}</span>{a.id === "builtin" && <span className="free-badge">限时免费</span>}{a.id === state.settings.defaultAgent && <span className="default-agent-badge">默认</span>}</strong>
          {status && <span>{status}</span>}</span>
        <span className="agent-choice-indicator">{selected === a.id && <Icon name="check" size={17} />}</span>
      </button>
        {!checking && !a.error && a.supported && a.installed === false && a.guide && <a className="agent-guide" href={a.guide} target="_blank" rel="noopener noreferrer" aria-label={`${a.name} 接入说明（打开官网）`}>接入说明<Icon name="source" size={12} /></a>}
      </div>;
  }
  return <Modal title="设置" className="settings-modal" busy={saving} onClose={onClose}>
    <nav className="settings-sections" aria-label="设置分类">
      <button type="button" aria-pressed={section === "agents"} onClick={() => setSection("agents")}><Icon name="chat" size={16} />Agent</button>
      <button type="button" aria-pressed={section === "about"} onClick={() => setSection("about")}><Icon name="info" size={16} />关于 Nota</button>
    </nav>
    <div className="settings-page agent-settings-page" hidden={section !== "agents"}>
    <div className="settings-section-heading"><h3>默认 Agent</h3><button disabled={checking || saving} onClick={() => void check()}><span className={checking ? "refresh-spinning" : ""}><Icon name="refresh" size={14} /></span>{checking ? "检测中…" : "重新检测"}</button></div>
    <div className="agent-settings-scroll">
    {!agents.length && checking && <div className="agent-detection" role="status"><span className="sr-only">正在检测本机 Agent</span>{Array.from(primaryIds, id => <div className="agent-skeleton" key={id} aria-hidden="true"><i /><span><b /><b /></span></div>)}</div>}
    <div className="local-agent-list" role="radiogroup" aria-label="选择默认 Agent" aria-busy={checking} onKeyDown={navigate}>
      {primary.map(renderAgent)}
      {additional.length > 0 && <>
        <button type="button" className="agent-disclosure" aria-expanded={expanded} aria-controls={moreId} onClick={() => setExpanded(!expanded)}>
          <Icon name="chevron" size={15} /><span>其他 Agent</span>
          {!expanded && hiddenDefault && <small>当前默认 · {hiddenDefault.name}</small>}
        </button>
        <div id={moreId} hidden={!expanded}>{expanded && additional.map(renderAgent)}</div>
      </>}

    </div>
    {!checking && !agents.length && !error && <p className="form-notice">未检测到 Agent，请重新检测。</p>}
    {chosen && (chosen.id === "codex" || chosen.id === "claude") && chosen.installed && !chosen.signedIn && !chosen.error && <div className="agent-login-command">在终端登录后重新检测<code>{chosen.id === "codex" ? "codex login" : "claude auth login"}</code></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!unchanged && taskBusy && <p className="form-notice">当前任务结束后可切换默认 Agent</p>}
    </div>
    <div className="settings-saved" role="status">{saved && unchanged ? "默认 Agent 已更新" : ""}</div>
    {!unchanged && <footer><button className="home-import" disabled={unchanged || !chosen?.installed || !chosen.signedIn || !chosen.supported || checking || saving || !!chosen.error || taskBusy} onClick={() => void apply()}>
      {saving && <i className="control-spinner" aria-hidden="true" />}{saving ? "正在保存…" : "设为默认 Agent"}
    </button></footer>}
    </div>
    <div className="settings-page" hidden={section !== "about"}><AboutNota /></div>
  </Modal>;
}
