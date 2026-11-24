// Explicit, non-destructive import of an already parsed paper; never copy chats.
import {
  readFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
const from = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw Error(
    "Usage: node scripts/import-prototype.mjs /path/to/paper-id [data-directory]",
  );
const paper = JSON.parse(readFileSync(join(from, "paper.json"), "utf8"));
if (
  !/^paper-[a-f0-9-]+$/.test(paper.id) ||
  !paper.parser ||
  !paper.coverage?.complete
)
  throw Error("Expected a complete parsed paper");
const root =
  process.argv[3] ||
  join(process.env.HOME, "Documents/PaperReadingWorkbench/v2");
const target = join(root, "papers", paper.id);
if (existsSync(target))
  throw Error("Paper already exists. Existing data was not changed.");
mkdirSync(join(root, "papers"), { recursive: true });
cpSync(from, target, { recursive: true });
// The parser outputs and translation sidecar are reusable. No user sessions/notes imported.
console.log(
  JSON.stringify({ paperId: paper.id, pages: paper.pages.length, target }),
);
