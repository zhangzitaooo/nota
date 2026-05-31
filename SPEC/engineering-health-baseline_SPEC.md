# Engineering Health Baseline Spec

Date: 2026-05-31
Project: paper-reading-workbench

## Summary

This spec defines a small engineering-health baseline before continuing major feature work such as product-owned web search, richer export, or deeper AI dialogue behavior.

The app is currently functional and can build, but recent rapid iteration has left several engineering risks:

- the project is not isolated as its own Git boundary;
- generated/cache files are easy to mix into source control;
- Electron IPC accepts broad renderer-provided inputs;
- tests are mostly smoke scripts rather than a stable gate;
- several core files are large enough that future edits can become fragile.

The goal is not to pause product development for a big refactor. The goal is to create a reliable baseline so future feature work remains reviewable, testable, and safe.

## Goals

- Make the project easy to review, revert, and commit safely.
- Put the project under a clear GitHub-backed source-control boundary.
- Prevent generated files and local caches from entering version control.
- Treat the renderer process as low-trust and validate file/project boundaries in the main process.
- Add a minimal test gate that covers the highest-risk product flows.
- Keep existing product behavior stable.
- Avoid large refactors unless they directly reduce risk for the touched area.

## Non-Goals

- Do not redesign the UI.
- Do not change PDF parsing behavior except where tests expose clear regressions.
- Do not implement the product-owned search provider in this spec.
- Do not treat GitHub as a substitute for IPC safety, tests, or runtime robustness.
- Do not convert the whole codebase to a new framework or state library.
- Do not split every large file immediately.
- Do not introduce a heavy test framework unless the first smoke tests clearly need it.

## Current Baseline

Verified on 2026-05-31:

- `npm run build` passes.
- `./node_modules/.bin/tsc -p tsconfig.electron.json` passes.
- `node tests/test_parse_clip.js sample/clip.pdf` completes.
- The CLIP sample parser smoke run returns 2691 blocks, with 329 translate-policy blocks.
- Runtime web search is disabled; `web_search` remains a tool stub.

Known weaknesses:

- Git root is `/Users/zhangzitao/Documents/PM`, not the project directory.
- `paper-reading-workbench` appears mostly untracked in the parent repo.
- `npm-cache/`, `tsconfig.electron.tsbuildinfo`, and generated outputs need clearer ignore treatment.
- `tests/test_parse_clip.js` fails when run without an explicit PDF argument.
- Most IPC methods pass `any` payloads from renderer to main.
- `ProjectStore` only has path-containment protection on delete, not every project file operation.
- `DeepSeekClient` has no request timeout.
- AI chat failure state is not persisted to `chats.json`.

## Phase 1: Repository And Artifact Hygiene

### Objective

Make source changes visible, generated artifacts invisible, and the project easy to back up, review, and roll back through GitHub.

### Work

1. Create a standalone Git repository at:

```text
/Users/zhangzitao/Documents/PM/projects/paper-reading-workbench
```

2. Create a GitHub remote for the project.
   - Preferred repo name: `paper-reading-workbench`.
   - Visibility can be private during active development.
   - Do not include local API keys, app data, generated PDFs, `node_modules`, or cache directories.
3. Update ignore rules for:
   - `node_modules/`
   - `dist/`
   - `dist-electron/`
   - `npm-cache/`
   - `*.tsbuildinfo`
   - `.DS_Store`
   - `.env*`, while preserving `.env.example` if added later.
4. Remove generated/cache noise from source-control status.
5. Create a baseline commit once the status is clean and build checks pass.
6. Push the baseline commit to GitHub.
7. From this point on, use small commits or branches for major feature work.

### Acceptance Criteria

- `git rev-parse --show-toplevel` inside the project returns the project path, not `/Users/zhangzitao/Documents/PM`.
- `git status --short` for this project only shows intentional source/spec changes.
- Generated outputs and local package caches are ignored.
- A developer can review a small feature diff without unrelated workspace noise.
- The baseline commit exists locally and on GitHub.
- The GitHub repo can be cloned and bootstrapped with `npm install`.

### What GitHub Solves

- Clear project ownership and source-control boundary.
- Reliable rollback to known-good commits.
- Cleaner code review and PR-style collaboration.
- A place to attach CI later.
- Easier app packaging/release history when the macOS app is ready.

### What GitHub Does Not Solve

- It does not fix IPC path safety by itself.
- It does not add test coverage by itself.
- It does not prevent DeepSeek/API hangs by itself.
- It does not improve PDF parser quality by itself.
- Those remain Phase 2-4 implementation work.

## Phase 2: IPC And File Boundary Guard

### Objective

Ensure renderer-provided IDs and paths cannot escape the app project directory.

### Work

1. Add centralized `ProjectStore` path helpers:
   - `assertSafeProjectId(projectId: string)`
   - `resolveProjectDir(projectId: string)`
   - `resolveProjectFile(projectId: string, fileName: string)`
   - `resolveProjectAsset(projectId: string, assetPath: string)`
2. Restrict project IDs to a safe format, such as:

```text
^[a-zA-Z0-9._-]+$
```

3. For every resolved path, verify:
   - it is inside `baseDir` for project-level operations;
   - it is inside the specific `projectDir` for document, chat, annotation, PDF, and asset operations.
4. Replace direct `path.join(this.getProjectDir(projectId), ...)` usage with the centralized helpers.
5. Validate basic IPC input types before passing them into services.

### Acceptance Criteria

- `../`, absolute paths, empty IDs, and malformed IDs are rejected.
- Normal import, open, delete, save document, save annotations, save chats, load asset, and export still work.
- `deleteProject` continues to never touch the user's original PDF path.
- IPC handlers avoid passing unvalidated `any` into file-writing services where practical.

## Phase 3: Test Gate

### Objective

Turn current manual checks into repeatable commands.

### Work

Add package scripts:

```json
{
  "typecheck": "tsc --noEmit",
  "typecheck:electron": "tsc -p tsconfig.electron.json",
  "test:parser": "node tests/test_parse_clip.js sample/clip.pdf",
  "test": "npm run typecheck && npm run typecheck:electron && npm run test:parser"
}
```

Improve `tests/test_parse_clip.js`:

- Default to `sample/clip.pdf` when no argument is provided.
- Add assertions instead of only printing diagnostics.
- Assert parser output includes:
  - at least one `title`, `abstract`, `heading`, and `paragraph`;
  - figure/table assets when available;
  - reference blocks skipped from translation;
  - figure body and table body skipped from translation;
  - translate-policy count within a broad expected range for the sample.
- Keep detailed diagnostic output behind a flag, such as `--verbose`.

Add lightweight unit or script tests for:

- overlapping annotations: highlight plus bold on the same text should render on the same text, not duplicate it;
- disabled `web_search`: tool call returns unavailable evidence and does not throw;
- project path guard rejects traversal.

### Acceptance Criteria

- `npm test` is the default health command.
- `npm test` passes locally without needing network access or a DeepSeek API key.
- Tests fail when parser gating accidentally sends references, figure bodies, or table bodies to translation.
- Tests fail when annotation overlap duplicates selected text.

## Phase 4: AI And Translation Robustness

### Objective

Prevent network/API failures from leaving the app in a confusing or stuck state.

### Work

1. Add request timeout support in `DeepSeekClient` using `AbortController`.
2. Classify common model/API errors:
   - missing API key;
   - network timeout;
   - HTTP error;
   - malformed response.
3. Persist AI error messages to `chats.json`, not only local React state.
4. Ensure pending assistant messages are replaced by success or error messages.
5. Keep translation retry behavior block-based:
   - failed blocks remain marked `failed`;
   - retry operates on failed blocks;
   - skipped/reference/asset blocks are not retried as normal translation blocks.

### Acceptance Criteria

- A hung DeepSeek request times out with a clear user-facing error.
- Refreshing after an AI failure preserves the failed assistant message.
- Translation failures can be retried without restarting the full paper.
- Missing API key produces a clear local configuration error.

## Phase 5: Opportunistic Module Splitting

### Objective

Reduce future edit risk without a disruptive rewrite.

### Strategy

Do not split large files only for aesthetics. Split when a future change touches that area and the boundary is obvious.

Preferred extraction targets:

- `src/App.tsx`
  - project lifecycle hook;
  - translation state hook;
  - chat state hook;
  - document context builder.
- `electron/services/pdf-parser.ts`
  - block classification;
  - asset extraction;
  - translation gating;
  - reference/table/figure detection.
- `electron/services/pdf-exporter.ts`
  - export HTML renderer;
  - annotation renderer;
  - Electron `printToPDF` runner.

### Acceptance Criteria

- No single cleanup PR performs a broad rewrite of all three files.
- Extracted modules have small public interfaces.
- Existing build and smoke tests pass after each extraction.

## Health Gate For Future Feature Work

Before starting significant new features, run:

```bash
git status --short
npm test
npm run build
```

For UI-heavy work, additionally verify the Electron app manually:

- app opens with one Electron instance;
- home page recent files render;
- import flow starts parsing and translation;
- reading page loads completed paragraphs before full translation completes;
- selection pill appears in AI input;
- highlight and bold can overlap;
- export PDF includes visible annotations.

## Execution Order

Recommended first implementation batch:

1. Phase 1: create standalone repo, connect GitHub remote, clean artifacts, and push baseline.
2. Phase 2: `ProjectStore` path guard.
3. Phase 3: `npm test` and parser smoke assertions.

Defer Phase 4 until after the first baseline commit unless a model/API failure is blocking daily use.

Defer Phase 5 until touching the relevant feature area.
