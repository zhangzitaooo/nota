// Preserve npm's nested dependency resolution when electron-builder flattens the tree.
const { execFileSync } = require('node:child_process');
const { cpSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

module.exports = async function completePackagedDependencies(context) {
  const root = context.packager.projectDir;
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const app = path.join(resources, 'app');
  const packages = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  }).trim().split(/\r?\n/);
  for (const source of packages) {
    const relative = path.relative(root, source);
    if (!relative.startsWith('node_modules' + path.sep)) continue;
    const target = path.join(app, relative);
    if (existsSync(path.join(target, 'package.json'))) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, {
      recursive: true, verbatimSymlinks: true,
      filter: file => file === source || path.basename(file) !== 'node_modules'
    });
  }
};
