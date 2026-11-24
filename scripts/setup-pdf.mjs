import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
function run(binary, args) {
  const r = spawnSync(binary, args, { cwd: root, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}
if (!existsSync(resolve(root, ".venv/bin/python")))
  run(process.env.PYTHON_BIN || "python3", ["-m", "venv", ".venv"]);
run(resolve(root, ".venv/bin/python"), [
  "-m",
  "pip",
  "install",
  "-r",
  "server/requirements.txt",
]);
