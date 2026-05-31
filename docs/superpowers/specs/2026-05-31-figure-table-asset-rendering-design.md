# Figure And Table Asset Rendering Design

## Background

The translated reader currently skips figure and table bodies so chart labels, table cells, axis ticks, and legend fragments do not pollute the translated prose. This is the right default for reading quality, but the fallback is only a quiet placeholder when no image asset exists.

The codebase already has most of the product shape for visual assets:

- `PaperBlock` supports `figure_asset`, `table_asset`, `assetPath`, `bbox`, and `figureId`.
- `PdfParser` can infer an asset region from a `figure_caption` or `table_caption`.
- `ReaderPane` can render an asset block as an image when `assetPath` exists.
- `pdf-exporter` can embed asset images in exported PDFs.
- `Translator` skips blocks whose `translationPolicy` is not `translate`.

The missing piece is a stable asset generation path. The existing cropper is disabled behind `ENABLE_FIGURE_ASSET_RENDERING=1` because the BrowserWindow-based renderer can crash Electron on macOS.

## Goal

When importing a PDF, preserve figure and table regions visually in the translated reader:

```text
original figure/table image
translated caption
```

The translated prose should not contain raw extracted figure or table internals.

## Non-Goals

- Do not translate text inside figures or tables.
- Do not reconstruct charts as HTML, SVG, Markdown tables, or structured data.
- Do not try to perfectly reproduce the original PDF page layout.
- Do not make the model responsible for detecting or cleaning figure/table internals.
- Do not block import or translation when asset rendering fails.

## Product Behavior

For each detected figure or table:

1. Keep the caption as a translatable text block.
2. Infer the visual body region from the caption and nearby low-confidence text blocks.
3. Render that region from the source PDF into a PNG under the project `assets/` directory.
4. Insert a `figure_asset` or `table_asset` block immediately before the caption.
5. Mark detected internal text blocks as `figure_body` or `table_body`.
6. Hide body blocks from the reader and exporter.
7. Render the original image if `assetPath` exists.
8. Render a quiet placeholder if the asset cannot be generated or loaded.

Target reader output:

```text
[original chart image]

图 11：CLIP 的特征优于最佳模型的特征。
```

Bad output to avoid:

```text
SST2 +23.6
GTSRB +14.7
SUN397 +6.5
...
```

## Architecture

### Existing Data Model

No large schema migration is needed. The current model is sufficient:

```ts
type BlockType =
  | 'figure_asset'
  | 'table_asset'
  | 'figure_caption'
  | 'table_caption'
  | 'figure_body'
  | 'table_body';

type TranslationPolicy = 'translate' | 'keep_original' | 'skip' | 'asset';

interface PaperBlock {
  type: BlockType;
  page?: number;
  bbox?: BBox;
  translationPolicy?: TranslationPolicy;
  skipReason?: string;
  assetPath?: string;
  figureId?: string;
}
```

The only recommended extension is optional diagnostic metadata for asset failures:

```ts
assetError?: string;
```

This field is not required for rendering. It is only for debugging import quality.

### Asset Storage

Generated images should stay inside each project:

```text
PaperReadingWorkbench/projects/<projectId>/
  source.pdf
  document.json
  assets/
    page-011-figure-001.png
    page-012-table-001.png
```

The parser should continue returning relative paths:

```text
assets/page-011-figure-001.png
```

The renderer should continue loading images through `loadAssetDataUrl(projectId, assetPath)`, not direct filesystem paths.

## Cropper Strategy

### Replace The BrowserWindow Cropper

Do not make the current BrowserWindow cropper the default. It is explicitly marked unstable on macOS.

Create a focused PDF region cropper service used by `PdfParser`, for example:

```ts
class PdfRegionCropper {
  cropRegionToPng(input: {
    pdfPath: string;
    pageNumber: number;
    bbox: BBox;
    pageSize: PageDimensions;
    outputPath: string;
    scale?: number;
  }): Promise<void>;
}
```

The first implementation should prefer `pdfjs-dist` page rendering plus Canvas-backed cropping without a hidden Electron `BrowserWindow`.

If a native Canvas dependency is not already reliable in Electron main, keep the cropper isolated behind this service so the implementation can change later without touching parser, reader, or exporter behavior.

### Coordinate Rules

`pdfjs` text coordinates and canvas pixels use different origins. The cropper must explicitly convert PDF-space bounding boxes into canvas-space rectangles:

```text
sourceX = bbox.x * scale
sourceY = (pageHeight - bbox.y - bbox.height) * scale
sourceWidth = bbox.width * scale
sourceHeight = bbox.height * scale
```

Clamp the source rectangle to page bounds before drawing.

### Image Quality

Default scale:

```text
2x
```

This is enough for most paper figures while keeping asset size manageable.

Output format:

```text
PNG
```

Use a white background before drawing, so transparent PDF regions do not render as black or empty.

## Region Inference

The existing caption-led strategy should remain the default:

```text
caption -> infer body region above caption -> crop body -> insert asset before caption
```

### Candidate Signals

Text blocks are likely figure/table body internals when they match several of these:

- low text quality score
- `translationPolicy: skip`
- `visual_noise`
- many numbers or percentages
- short labels without sentence endings
- axis or legend-like patterns
- table-like rows with multiple numeric tokens
- same page and visually near the caption
- located between nearby prose and a figure/table caption

### Crop Boundaries

The crop should include the original visual body, not the translated caption.

Recommended default:

- bottom: just above the caption, with a small margin
- top: top edge of candidate body blocks, plus margin
- x/width: same column if the caption and candidates are column-local
- x/width: page-wide if the caption or candidates span a wide region

Avoid overly tall crops. If inferred height exceeds a conservative limit, prefer a bounded region near the caption rather than capturing unrelated paragraphs.

### Tables

Tables use the same asset path as figures in v1:

```text
table body -> original table image
table caption -> translated caption
```

No HTML table reconstruction in this pass.

## Translation Rules

The translator should never receive asset or body blocks:

```text
figure_caption/table_caption -> translate
figure_asset/table_asset -> skip, status done
figure_body/table_body -> skip, status done
visual_noise -> skip, status done
```

For skipped asset/body blocks, `zh` may remain empty or mirror `en`; rendering must depend on `type` and `assetPath`, not `zh`.

## Reader Rendering

Reader behavior:

```text
figure_asset/table_asset with assetPath -> render image
figure_asset/table_asset without assetPath -> render quiet placeholder
figure_caption/table_caption -> render translated caption
figure_body/table_body -> hidden
visual_noise -> hidden
```

Images should be centered and constrained to the reading column:

```css
max-width: 100%;
height: auto;
```

Placeholders should stay visually subdued and should not look like an error state.

## PDF Export Rendering

Export should follow the same visible-block rules as the reader:

```text
asset image if available
quiet placeholder if missing
translated caption
no figure/table body text
```

The exporter should embed images as data URLs, as it already does, so generated export HTML remains self-contained.

## Failure Handling

Asset generation failure must not fail PDF import.

If cropping fails:

1. Keep the `figure_asset` or `table_asset` block.
2. Leave `assetPath` empty.
3. Optionally record `assetError`.
4. Keep internal body blocks hidden.
5. Let the reader render the placeholder.

This preserves the most important behavior: figure/table internals do not become translated prose.

## Rollout Plan

1. Extract the current region-rendering logic into a dedicated cropper service.
2. Replace the hidden BrowserWindow implementation with a stable pdfjs/canvas cropper.
3. Keep the current BrowserWindow cropper removed or gated as a fallback only during development.
4. Add parser diagnostics for asset generation success/failure.
5. Add focused parser tests for figure and table asset blocks.
6. Test import visually with the CLIP sample PDF and at least one table-heavy PDF.
7. Verify reader display.
8. Verify PDF export display.

## Testing

### Automated

Add or extend parser tests to assert:

- figure captions produce a `figure_asset` before the caption
- table captions produce a `table_asset` before the caption
- asset blocks use `translationPolicy: asset`
- detected body blocks use `translationPolicy: skip`
- body blocks are not counted as translation targets
- generated `assetPath` points under `assets/`
- missing crop output does not throw import-level errors

### Manual

Use a paper page with a known chart:

1. Import the PDF.
2. Wait for translation to complete.
3. Confirm the original chart image appears in the reader.
4. Confirm the caption appears translated below it.
5. Confirm chart labels and scores do not appear as prose.
6. Export PDF.
7. Confirm the exported PDF includes the chart image and translated caption.

## Acceptance Criteria

- Importing a PDF with a detected figure shows the original figure image in the translated reader.
- Importing a PDF with a detected table shows the original table image in the translated reader.
- Figure/table captions are still translated.
- Figure/table internal text is not translated and not rendered as prose.
- Asset generation failure falls back to the existing quiet placeholder.
- The app does not require `ENABLE_FIGURE_ASSET_RENDERING=1` for normal asset generation.
- The implementation does not use the unstable BrowserWindow cropper as the default path.
- Exported PDFs preserve the same image-plus-caption behavior.

## Implementation Choice

The default cropper backend should be:

```text
pdfjs-dist page rendering + Canvas-backed crop
```

If main-process Canvas proves unreliable in Electron, use a small isolated renderer process dedicated to cropping as the fallback backend.

Both backends must preserve the same `PdfRegionCropper` interface so parser, reader, and exporter behavior stay stable.
