import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class JsonlClient {
  constructor(command, args, options = {}) {
    this.pending = new Map(); this.seq = 0; this.closed = false;
    this.proc = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdin.on('error', () => {});
    this.proc.stderr.on('data', () => {}); // Never echo credentials or arbitrary runtime output.
    createInterface({ input: this.proc.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      const id = m.id ?? m.response?.request_id;
      const pending = this.pending.get(id);
      if (pending && !m.method && m.type !== 'control_request') {
        this.pending.delete(id); clearTimeout(pending.timer);
        const error = m.error || (m.response?.subtype === 'error' ? { message: m.response.error } : null);
        error ? pending.reject(Error(error.message || '运行时请求失败')) : pending.resolve(m.result ?? m.response?.response);
      } else options.onMessage?.(m, this);
    });
    const end = () => { if (this.closed) return; this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Agent 运行时已关闭')); } this.pending.clear(); options.onExit?.(); };
    this.proc.on('error', end); this.proc.on('exit', end);
  }
  send(m) { if (!this.closed && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params = {}, timeout = 20000, control = false) {
    if (this.closed) return Promise.reject(Error('Agent 运行时已关闭'));
    const id = control ? String(++this.seq) : ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Agent 请求超时，请重试')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send(control ? { type: 'control_request', request_id: id, request: { subtype: method, ...params } } : { id, method, params });
    });
  }
  close() { this.proc.kill(); }
}
