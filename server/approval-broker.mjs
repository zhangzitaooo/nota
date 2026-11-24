import { randomUUID } from 'node:crypto';

export class ApprovalBroker {
  pending = new Map();
  constructor(changed = () => {}) { this.changed = changed; }
  list() { return [...this.pending.values()].map(({ record }) => record); }
  request(provider, operation, reason = '') {
    return new Promise(resolve => {
      const id = randomUUID();
      const record = { id, provider, operation: String(operation).slice(0, 2000), reason: String(reason).slice(0, 1000) };
      const timer = setTimeout(() => this.answer(id, false), 180000);
      this.pending.set(id, { record, resolve, timer }); this.changed();
    });
  }
  answer(id, allowed) {
    const p = this.pending.get(id); if (!p) return false;
    this.pending.delete(id); clearTimeout(p.timer); p.resolve(allowed === true); this.changed(); return true;
  }
  cancel() { for (const id of this.pending.keys()) this.answer(id, false); }
}
