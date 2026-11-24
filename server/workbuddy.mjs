import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export function workBuddyLaunch() {
  const env = { ...process.env, CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1',
    WORKBUDDY_CONFIG_DIR: process.env.WORKBUDDY_CONFIG_DIR || join(homedir(), '.workbuddy') };
  if (process.env.WORKBUDDY_BIN) return { bin: process.env.WORKBUDDY_BIN, prefix: [], env };
  const scripts = ['/Applications', join(homedir(), 'Applications')].map(dir =>
    join(dir, 'WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'));
  const script = scripts.find(existsSync);
  if (!script) return null;
  return { bin: process.execPath, prefix: [script], env };
}

// The desktop CLI publishes its configured model selectors in its command help.
// A configured model can be selected before its first actual inference request.
export async function inspectWorkBuddy() {
  const launch = workBuddyLaunch();
  if (!launch) return { installed: false, signedIn: false, models: [] };
  try {
    const { stdout } = await exec(launch.bin, [...launch.prefix, '--help'], {
      env: launch.env, timeout: 12000, maxBuffer: 256 * 1024
    });
    const options = stdout.split('\n').find(line => /^\s*--model <model>/.test(line)) || '';
    const ids = [...new Set(options.match(/custom-local:[^,\s)]+/g) || [])];
    const models = ids.map((id, i) => ({ id, name: id.slice('custom-local:'.length),
      default: i === 0, efforts: [], defaultEffort: null }));
    return { installed: true, signedIn: models.length > 0, models };
  } catch (error) {
    if (error.code === 'ENOENT') return { installed: false, signedIn: false, models: [] };
    throw Error('WorkBuddy 会话入口启动失败，请检查桌面应用');
  }
}
