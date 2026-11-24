import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectWorkBuddy } from './workbuddy.mjs';
import { builtinStatus } from './agent-config.mjs';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
const exec = promisify(execFile);

export async function agentStatus(binary = process.env.CODEX_BIN || "codex") {
  const options = { timeout: 8000, maxBuffer: 16384 };
  let version;
  try {
    const result = await exec(binary, ["--version"], options);
    version = result.stdout.trim().slice(0, 120);
  } catch (e) {
    if (e.code === "ENOENT") return { installed: false, signedIn: false };
    throw Error("无法检测本机 Codex，请检查安装后重试");
  }
  try {
    // Return only the exit status; never expose account or credential output.
    await exec(binary, ["login", "status"], options);
    return { installed: true, signedIn: true, version };
  } catch (e) {
    if (e.code === 1) return { installed: true, signedIn: false, version };
    throw Error("无法检测 Codex 登录状态，请稍后重试");
  }
}

export const agentProviders = [
  { id: 'builtin', name: 'Nota Agent', supported: true, builtin: true },
  { id: 'codex', name: 'Codex', supported: true, guide: 'https://openai.com/codex/' },
  { id: 'claude', name: 'Claude Code', supported: true, guide: 'https://claude.com/product/claude-code' },
  { id: 'antigravity', name: 'Antigravity CLI', supported: false, guide: 'https://antigravity.google/docs/cli/' },
  { id: 'workbuddy', name: 'WorkBuddy', supported: true, guide: 'https://www.codebuddy.cn/work/' },
  { id: 'deepseek', name: 'DeepSeek Harness', supported: false, guide: 'https://deepseek.com/harness/' },
  { id: 'opencode', name: 'OpenCode', supported: false, guide: 'https://opencode.ai/' },
];
export async function providerStatus(id, dataDir) {
  if (id === 'builtin') return builtinStatus(dataDir);
  if (id === 'codex') return agentStatus();
  if (id === 'workbuddy') {
    const { installed, signedIn } = await inspectWorkBuddy();
    return { installed, signedIn };
  }
  if (id !== 'claude') throw Error('暂不支持此 Agent');
  const options = { timeout: 8000, maxBuffer: 16384 };
  let version;
  try { version = (await exec(process.env.CLAUDE_BIN || 'claude', ['--version'], options)).stdout.trim().slice(0,120); }
  catch (e) { if (e.code === 'ENOENT') return { installed: false, signedIn: false }; throw Error('无法检测 Claude Code'); }
  try { await exec(process.env.CLAUDE_BIN || 'claude', ['auth','status'], options); return { installed: true, signedIn: true, version }; }
  catch(e) { if (e.code === 1) return { installed: true, signedIn: false, version }; throw Error('无法检测 Claude Code 登录状态'); }
}
// Detect user installations without starting an agent or reading its credentials.
async function isInstalled(id) {
  const specs = {
    antigravity: { bin: 'agy', override: process.env.AGY_BIN },
    deepseek: { bin: 'dsh', override: process.env.DSH_BIN, app: 'DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' },
    opencode: { bin: 'opencode', override: process.env.OPENCODE_BIN },
  };
  const { bin, override, app } = specs[id];
  const dirs = [...(process.env.PATH || '').split(delimiter).filter(Boolean), join(homedir(), '.local/bin')];
  const candidates = dirs.map(dir => join(dir, bin));
  if (app && process.platform === 'darwin') {
    candidates.push(join('/Applications', app), join(homedir(), 'Applications', app));
  }
  const bundledModules = resolve(import.meta.dirname, '../node_modules') + sep;
  for (const file of override ? [override] : new Set(candidates)) {
    try {
      const target = await realpath(file);
      if (target.startsWith(bundledModules)) continue;
      await access(target, constants.X_OK);
      if ((await stat(target)).isFile()) return true;
    } catch (e) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(e.code)) throw e;
    }
  }
  return false;
}
export async function discoverAgents(dataDir) {
  return Promise.all(agentProviders.map(async p => {
    try {
      if (p.supported) return { ...p, ...await providerStatus(p.id, dataDir) };
      return { ...p, installed: await isInstalled(p.id), signedIn: false };
    } catch (e) {
      if (e.code === "ENOENT") return { ...p, installed: false, signedIn: false };
      return { ...p, installed: null, signedIn: false, error: "检测失败，请重试" };
    }
  }));
}
