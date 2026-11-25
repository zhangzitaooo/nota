import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { builtinConnection, trialGateway } from './agent-config.mjs';
import { gatewayHeaders } from './nota-relay.mjs';

export function createQuestionQuota(dir) {
  const file = join(dir, 'question-settlements.json');
  const pending = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const save = () => {
    writeFileSync(file + '.tmp', JSON.stringify(pending), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  };
  const identity = c => createHash('sha256').update(c.baseURL + '\n' + c.token).digest('hex');
  async function connection() {
    const c = await builtinConnection(dir);
    return c && (c.baseURL === trialGateway || c.token.startsWith('nota-trial-v1-')) ? c : null;
  }
  async function request(c, suffix) {
    const response = await fetch(c.baseURL + '/questions' + suffix, {
      method: suffix ? 'POST' : 'GET', headers: gatewayHeaders(c), redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error?.message || '提问额度暂时无法读取'), {status:response.status});
    return data;
  }
  async function flush(c) {
    for (const [id, entry] of Object.entries(pending)) {
      if (entry.install !== identity(c)) continue;
      try { await request(c, '/' + id + '/' + entry.action); }
      catch (error) { if (error.status !== 410) throw error; }
      delete pending[id]; save();
    }
  }
  return {
    async balance() {
      const c = await connection();
      if (!c) return {remaining:null};
      await flush(c);
      return request(c, '');
    },
    async begin(id) {
      const c = await connection();
      if (!c) return null;
      await flush(c);
      await request(c, '/' + id + '/begin');
      return c;
    },
    async finish(c, id, answered) {
      if (!c) return;
      pending[id] = {install:identity(c),action:answered ? 'answer' : 'cancel'};
      save();
      // Retry a lost acknowledgement on the next balance read or question,
      // including after restarting the desktop app.
      await flush(c).catch(() => {});
    },
  };
}
