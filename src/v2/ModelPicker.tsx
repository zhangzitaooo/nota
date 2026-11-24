import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModelOption, Snapshot, Provider } from "./types";
import { command } from "./api";
import { Icon } from "./Icon";

const depthOrder = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function depthChoices(options: ModelOption["efforts"]) {
  const supported = depthOrder.filter(id => options.some(option => option.id === id));
  if (supported.length <= 2) {
    return supported.map(id => ({ id, name: id === "medium" ? "中" : depthOrder.indexOf(id) < 2 ? "低" : "高" }));
  }
  const candidates = supported.slice(0, -2);
  const low = candidates.includes("low") ? "low" : candidates[0];
  const middleOptions = supported.slice(supported.indexOf(low) + 1, -1);
  const middle = middleOptions.includes("medium") ? "medium" : middleOptions[0];
  const high = supported[supported.indexOf(middle) + 1];
  return [{ id: low, name: "低" }, { id: middle, name: "中" }, { id: high, name: "高" }];
}

function currentDepth(choices: ReturnType<typeof depthChoices>, effort?: string | null) {
  if (!effort || !depthOrder.includes(effort)) return;
  const distance = (id: string) => Math.abs(depthOrder.indexOf(id) - depthOrder.indexOf(effort));
  return choices.reduce<typeof choices[number] | undefined>((best, choice) =>
    !best || distance(choice.id) < distance(best.id) ? choice : best, undefined);
}
const providerNames = { builtin: "Nota Agent", codex: "Codex", claude: "Claude Code", workbuddy: "WorkBuddy" };
type Agent = { id: Provider; name: string; supported: boolean; installed: boolean | null; signedIn: boolean };
type Change = { provider: Provider } | { model: string };

export function ModelPicker({ state, onState, onSettings }: { state: Snapshot; onState: (s: Snapshot) => void; onSettings: () => void }) {
  const conversation = state.conversations.find(c => c.id === state.activeConversationId)!;
  const paperId = state.paper.id, conversationId = conversation.id, provider = conversation.provider;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const modelToggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingEffort, setPendingEffort] = useState<string>();
  const latestEffort = useRef<string>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [modelError, setModelError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [retry, setRetry] = useState(0);
  const model = models.find(m => m.id === conversation.model) || (!conversation.model ? models.find(m => m.default) || models[0] : undefined);
  const effort = pendingEffort ?? conversation.effort ?? model?.defaultEffort;
  const title = model?.name || conversation.model;
  const efforts = depthChoices(model?.efforts || []);
  const selectedDepth = currentDepth(efforts, effort);
  const error = saveError || agentError || modelError;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setModels([]); setModelError(""); setModelsOpen(false);
    fetch(`/api/models?${new URLSearchParams({ paperId, conversationId })}`, { signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw Error(data.error || "无法获取模型");
      setModels(data.models);
    }).catch(e => { if (!controller.signal.aborted) setModelError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [paperId, conversationId, provider, retry]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAgentError("");
    fetch("/api/settings", { signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw Error(data.error || "无法获取助手");
      setAgents(data.agents.filter((a: Agent) => a.supported));
    }).catch(e => { if (!controller.signal.aborted) setAgentError(e.message); });
    const dismiss = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => { controller.abort(); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); };
  }, [open, retry]);

  useLayoutEffect(() => {
    const panel = popover.current;
    const anchor = trigger.current;
    if (!open || !panel || !anchor) return;
    const fit = () => {
      const rect = anchor.getBoundingClientRect();
      const above = rect.top - 12, below = window.innerHeight - rect.bottom - 12;
      const useBelow = above < 240 && below > above;
      panel.dataset.side = useBelow ? "below" : "above";
      panel.style.maxHeight = Math.min(420, Math.max(0, useBelow ? below : above)) + "px";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(anchor);
    if (anchor.form) observer.observe(anchor.form);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [open]);

  // Keep the latest click visible while serializing writes to this conversation.
  async function chooseEffort(value: string) {
    if (!model || saving || (effort ?? "") === value) return;
    const writing = latestEffort.current !== undefined;
    latestEffort.current = value;
    setPendingEffort(value); setSaveError("");
    if (writing) return;
    while (mounted.current) {
      const next: string = latestEffort.current!;
      try {
        const snapshot = await command<Snapshot>("conversations/config", { paperId, conversationId, model: model.id, effort: next || null });
        if (mounted.current) onState(snapshot);
      } catch (e) {
        if (mounted.current && latestEffort.current === next) setSaveError((e as Error).message);
      }
      if (latestEffort.current === next) break;
    }
    latestEffort.current = undefined;
    if (mounted.current) setPendingEffort(undefined);
  }

  const previousModelsOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && modelsOpen) {
      const list = popover.current;
      (list?.querySelector<HTMLElement>(".picker-models button[aria-pressed=true]") || list?.querySelector<HTMLElement>(".picker-models button"))?.focus();
    } else if (open && previousModelsOpen.current) modelToggle.current?.focus();
    previousModelsOpen.current = modelsOpen;
  }, [modelsOpen, open]);

  async function change(config: Change) {
    if (latestEffort.current !== undefined || saving) return;
    // Keep keyboard focus in the picker while the selected button is disabled.
    if (root.current?.contains(document.activeElement)) trigger.current?.focus();
    setSaving(true); setSaveError("");
    try {
      const path = "provider" in config ? "conversations/agent" : "conversations/config";
      onState(await command<Snapshot>(path, { paperId, conversationId, ...config }));
      setModelsOpen(false);
    } catch (e) { setSaveError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <div className="model-picker" ref={root} onKeyDown={e => {
    if (e.nativeEvent.isComposing || !open) return;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (modelsOpen) setModelsOpen(false);
      else { setOpen(false); trigger.current?.focus(); }
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      const buttons = Array.from(root.current!.querySelectorAll<HTMLButtonElement>(modelsOpen ? '.picker-models button:enabled' : '[role="dialog"] button:enabled'));
      if (!buttons.length) return;
      e.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? index + 1 : index < 0 ? buttons.length - 1 : index - 1;
      buttons[(next + buttons.length) % buttons.length].focus();
    }
  }}>
    <button ref={trigger} type="button" className="model-trigger" aria-label="选择对话助手和思考深度" aria-expanded={open} aria-haspopup="dialog"
      title={`${providerNames[provider]} · 后续消息使用此配置`} onClick={() => { setOpen(!open); setModelsOpen(false); setSaveError(""); }}>
      <img src={`/assets/nota-agent-${provider}.png`} alt="" width="17" height="17" />
      <span className="model-name">{providerNames[provider]}</span>
      {selectedDepth && <span className="model-effort">{selectedDepth.name}</span>}
      <span className="model-chevron"><Icon name="chevron" size={12} /></span>
    </button>
    {open && <div ref={popover} className="model-popover" role="dialog" aria-label="对话助手">
      {!modelsOpen && <>
        <div className="picker-heading"><span>对话助手</span><button type="button" title="助手设置" aria-label="助手设置" onClick={() => { setOpen(false); onSettings(); }}><Icon name="settings" size={14} /></button></div>
        {!agents.length && !agentError && <div className="picker-message" role="status">正在查找助手…</div>}
        {agents.map(a => {
          const active = a.id === provider;
          const status = a.installed === null ? "检测失败" : !a.installed ? "未安装" : !a.signedIn ? (a.id === "builtin" ? "未开通" : a.id === "workbuddy" ? "需配置模型" : "需登录") : "";
          return <button key={a.id} className="picker-agent" type="button" aria-pressed={active}
            disabled={saving || state.busy || state.connection === "connecting" || !!status}
            onClick={() => { if (!active) void change({ provider: a.id }); }}>
            <img src={`/assets/nota-agent-${a.id}.png`} alt="" width="22" height="22" />
            <span>{a.name}{active && models.length === 1 && <small>{title}</small>}</span>
            {status && <small>{status}</small>}{active && <Icon name="check" size={15} />}
          </button>;
        })}
        {loading && <div className="picker-message" role="status">正在读取模型…</div>}
        {models.length > 1 && <div className="picker-section">
          <button ref={modelToggle} className="picker-model-toggle" type="button" aria-expanded={modelsOpen} onClick={() => setModelsOpen(true)}>
            <span>模型</span><strong>{title || "选择模型"}</strong><span className="model-next"><Icon name="chevron" size={12} /></span>
          </button>
        </div>}
        {!!efforts.length && model && <div className="picker-section picker-depth">
          <span className="picker-label">思考深度</span>
          <div className="picker-efforts" role="group" aria-label="思考深度">
            {efforts.map(e =>
              <button type="button" key={e.id} aria-pressed={selectedDepth?.id === e.id} disabled={saving}
                onClick={() => void chooseEffort(e.id)}>{e.name}</button>)}
          </div>
        </div>}
      </>}
      {modelsOpen && <div className="picker-model-page">
        <div className="picker-model-heading">
          <button className="picker-back" type="button" title="返回" aria-label="返回助手设置" onClick={() => setModelsOpen(false)}><Icon name="chevron" size={14} /></button>
          <span>{providerNames[provider]} 模型</span>
        </div>
        <div className="picker-models">{models.map(m => <button type="button" key={m.id} disabled={saving} aria-pressed={m.id === model?.id} onClick={() => { void change({ model: m.id }); }}>
          {m.name}{m.id === model?.id && <Icon name="check" size={14} />}</button>)}
        </div>
      </div>}
      {error && <div className="picker-message" role="alert">{error} {(!saveError || agentError || modelError) && <button type="button" onClick={() => { setSaveError(""); setRetry(v => v + 1); }}>重试</button>}</div>}
    </div>}
  </div>;
}
