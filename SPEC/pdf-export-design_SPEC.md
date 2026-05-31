# PDF Export Design

Date: 2026-05-30
Project: paper-reading-workbench

## Summary

Implement a first-pass PDF export for the reading workspace. The exported file should preserve the user's visible reading content and annotations: translated Chinese text, headings, paragraph structure, figure/table asset placeholders when available, highlight marks, and bold marks.

This is a document export feature, not a PDF layout restoration feature. The exported PDF should match the app's structured reading view, not the original paper's two-column PDF layout.

## Goals

- Add a real export action behind the existing top-bar `导出` button.
- Export a PDF file chosen by the user through a native save dialog.
- Preserve user annotations:
  - `highlight` becomes a visible yellow mark.
  - `bold` becomes strong text.
- Export the same readable content shown in the reader pane, including the same noise filtering rules.
- Keep all file writing inside the Electron main process.
- Keep the renderer free of filesystem access and PDF generation details.
- Give the user clear success and failure feedback.

## Non-Goals

- Do not recreate the original PDF layout.
- Do not export the original English PDF with coordinate annotations.
- Do not support Markdown, HTML, Word, Notion, or project backup export in this iteration.
- Do not add annotation editing, annotation lists, or export settings.
- Do not depend on network calls or translation during export.
- Do not fix existing PDF parsing quality issues as part of export.

## Current Code Context

The app already has the necessary source data:

- `document.json` stores paper metadata and `PaperBlock[]`.
- `annotations.json` stores highlight and bold ranges by `blockId`.
- `ProjectStore` owns project directory access in Electron main.
- `preload.ts` exposes safe IPC calls to the renderer.
- `ReaderPane` filters the full block stream into readable content.
- `renderBlockHtml` applies annotations to a single block for the live reader.

The current export button is a placeholder in `src/App.tsx`.

## User Experience

When the user clicks `导出`:

1. The app opens a native save dialog.
2. The default filename is based on the paper title, ending in `.pdf`.
3. If the user cancels, nothing changes.
4. If the user confirms, the app generates a PDF in the selected path.
5. The export button shows a temporary exporting state and is disabled while work is running.
6. On success, the app confirms the export completed.
7. On failure, the app shows a concise error message.

The first version does not need an export settings dialog. It exports the current reading document with annotations.

## Exported Content

The export should include:

- Paper title.
- Visible title, heading, abstract, paragraph, figure caption, table caption, formula, and available figure/table asset blocks.
- Chinese text when `zh` exists.
- English text only as fallback when `zh` is empty.
- Highlight and bold annotations applied to exported text.
- Page numbers may be included subtly for traceability if already present on blocks.

The export should exclude the same categories the reader pane currently excludes:

- Repeated page headers.
- Page footers.
- Footnotes.
- Visual noise.
- Figure/table body OCR fragments.
- Reference blocks and content after the references section.
- Blocks whose `translationPolicy` is `skip`, except figure/table asset blocks that represent visible skipped regions.

For V1, the exporter should implement the same filtering rules in the Electron export service. A later refactor can move the reader/export/progress filters into a shared package. The current `tsconfig.electron.json` compiles only `electron/`, so directly importing `src/domain` from Electron main is out of scope for this iteration.

## Architecture

### Renderer

Add a `handleExportPdf` action in `App.tsx`.

Responsibilities:

- Check that `projectId` and `document` exist.
- Set an `exporting` UI state.
- Call `window.electronAPI.exportPdf(projectId)`.
- Display success, cancellation, or error feedback.

The renderer should not pass the whole document payload unless necessary. The main process can read the latest saved project files by `projectId`, which avoids exporting stale renderer state during background translation.

### Preload

Expose one new API:

```ts
exportPdf: (projectId: string) => Promise<ExportPdfResult>
```

Result shape:

```ts
type ExportPdfResult =
  | { status: "success"; filePath: string }
  | { status: "cancelled" };
```

Failures should reject with an error, matching existing IPC patterns.

### Electron Main

Register a new IPC handler:

```ts
ipcMain.handle("export-pdf", async (_event, projectId: string) => {
  return exporter.exportProjectToPdf(projectId);
});
```

The main process owns:

- Loading `document.json` and `annotations.json`.
- Opening `dialog.showSaveDialog`.
- Generating export HTML.
- Rendering HTML in a hidden `BrowserWindow`.
- Calling `webContents.printToPDF`.
- Writing the PDF to disk.

### Export Service

Add a focused Electron service, for example `electron/services/pdf-exporter.ts`.

Responsibilities:

- Validate project data.
- Build a safe default filename.
- Convert readable blocks plus annotations into standalone HTML.
- Load HTML into a hidden window.
- Generate PDF bytes through Electron.
- Write the selected file.
- Always close the hidden export window.

The service should depend on `ProjectStore` for project reads and asset reads, not duplicate path traversal logic.

The export window must be safer than the earlier PDF figure cropper path:

- `show: false`
- `nodeIntegration: false`
- `contextIsolation: true`
- no remote URLs
- no dynamic PDF.js/canvas rendering
- destroy the window in `finally`

## HTML Rendering Strategy

Generate a complete standalone HTML document:

- Inline CSS for typography, page margins, headings, paragraphs, captions, formulas, highlights, and bold text.
- Escape all block text before inserting it.
- Apply annotation ranges in text order.
- Use `<mark>` for highlight and `<strong>` for bold.
- Use conservative print styles for A4 or US Letter compatibility.

Only apply annotations when exporting `zh` text. Existing annotation offsets are based on the translated reading text. If a block falls back to English because `zh` is empty, export the fallback text without applying those translated-text offsets.

Recommended visual defaults:

- Body width suitable for print.
- Clear title hierarchy.
- Comfortable paragraph line height.
- Highlight color: pale yellow.
- Figure/table assets centered and constrained to page width.
- Captions smaller and muted.

Overlapping annotations should be handled conservatively. For v1, if ranges overlap, apply them in sorted order and avoid crashing. A later iteration can add precise nested annotation handling if needed.

## Asset Handling

If a block has an `assetPath`, the exporter should attempt to embed it as a data URL using the existing project asset read path.

If the asset is missing:

- Render a small placeholder matching the reader behavior.
- Continue exporting.

Current parser behavior often creates `figure_asset` / `table_asset` blocks without a real image because screenshot cropping is disabled by default for stability. V1 should therefore expect placeholders for many figures and tables. Restoring true figure/table screenshots belongs to a later stable-renderer pass.

The exporter must not reference local filesystem image paths directly in the HTML because the hidden window should render a self-contained document.

## Error Handling

Expected cases:

- Missing `document.json`: reject with `没有可导出的论文内容`.
- User cancels save dialog: return `{ status: "cancelled" }`.
- PDF generation fails: reject with `导出 PDF 失败`.
- File write fails: reject with the underlying error message when useful.
- Missing assets: do not fail the export.

The hidden `BrowserWindow` must be closed in a `finally` block.

## Security

- Renderer only sends `projectId`.
- Main process resolves project paths through `ProjectStore`.
- Export destination comes from Electron's native save dialog.
- HTML generation escapes user-visible text.
- No remote content is loaded into the export window.

## Testing

Manual verification:

1. Import or open the CLIP sample project.
2. Add a highlight annotation to translated text.
3. Add a bold annotation to translated text.
4. Click `导出`.
5. Save as PDF.
6. Open the exported PDF and confirm:
   - title and headings appear,
   - translated paragraphs appear,
   - highlight is visible,
   - bold is visible,
   - page header/footer noise is absent,
   - references are absent,
   - missing image assets do not break export.

Automated or script-level checks:

- Unit-test the shared visible-block filter with representative block types.
- Unit-test annotation-to-HTML rendering for highlight, bold, empty annotations, and overlapping ranges.
- Run `npm run build`.

## Acceptance Criteria

- Clicking `导出` generates a PDF through a native save dialog.
- The exported PDF preserves highlight and bold annotations.
- The exported PDF uses the same readable block filtering as the reader.
- Export cancellation does not show an error.
- Export failure shows a clear error.
- The app still builds successfully.

## Open Decisions

- Whether to include subtle source page numbers in the exported PDF. Default: include only if it does not clutter the reading flow.
- Whether export success should offer an `打开文件` action. Default: not required for v1.
- Whether references should be exportable through a later setting. Default: exclude for v1 to match the current reader.
