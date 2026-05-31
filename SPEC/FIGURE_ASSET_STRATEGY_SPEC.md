# Figure Asset Strategy Spec

## 1. Problem

The current parser extracts text from figures and treats some of that text as normal reading blocks. In translated output, chart labels such as dataset names, axis ticks, scores, and legends are reflowed as headings or paragraphs.

This produces broken reading output:

- Figure internals are split into large text blocks.
- Bar chart labels and values appear as prose.
- The original visual relationship is lost.
- Captions may still be translated, but the figure itself is no longer readable.

The root cause is that figure bodies are handled as text, not as visual assets.

## 2. Product Principle

For V1, figures should be preserved visually rather than reconstructed textually.

Default behavior:

```text
figure body -> screenshot asset
figure caption -> translated text
figure internal text -> not translated, not rendered as reading prose
```

If figure detection is uncertain, prefer hiding suspected figure-body text over showing it as translated prose.

## 3. Target Output

The translated reading view should render figures like this:

```text
[figure screenshot]

图 11：CLIP 的特征优于最佳模型的特征。
```

It should not render figure internals like this:

```text
SST2 +23.6
GTSRB +14.7
SUN397 +6.5
...
得分（%）逻辑回归在 CLIP 与 EfficientNet L2 NS 上的对比
```

## 4. Data Model

Add or enforce these block fields:

```ts
type BlockType =
  | 'figure_asset'
  | 'figure_caption'
  | 'figure_body'
  | 'paragraph'
  | 'heading'
  | 'visual_noise';

type TranslationPolicy = 'translate' | 'skip' | 'asset';

interface FigureAssetBlock {
  id: string;
  type: 'figure_asset';
  page: number;
  order: number;
  sectionPath: string[];
  en: '';
  zh: '';
  translationPolicy: 'asset';
  assetPath: string;
  bbox: BBox;
  figureId?: string;
}

interface FigureCaptionBlock {
  id: string;
  type: 'figure_caption';
  page: number;
  order: number;
  sectionPath: string[];
  en: string;
  zh: string;
  translationPolicy: 'translate';
  figureId?: string;
}

interface FigureBodyBlock {
  id: string;
  type: 'figure_body';
  page: number;
  order: number;
  sectionPath: string[];
  en: string;
  zh: string;
  translationPolicy: 'skip';
  skipReason: 'figure body text';
  figureId?: string;
}
```

Project file layout:

```text
paper-project/
  source.pdf
  document.json
  assets/
    page-011-figure-001.png
```

## 5. Parsing Strategy

### 5.1 Detect Captions

Detect figure captions using patterns:

```text
Figure 1.
Figure 1:
Fig. 1.
Fig 1:
图 1：
```

Caption detection should happen before normal paragraph and heading classification.

The caption becomes a `figure_caption` block and enters translation.

### 5.2 Locate Figure Body

After detecting a caption, infer the figure body region on the same page.

Primary assumption for academic PDFs:

```text
figure body is usually above its caption
```

For a caption at `captionBbox`, estimate:

```text
figureTop = nearest safe upper boundary
figureBottom = captionBbox.y + captionBbox.height + small margin
figureLeft = page content left boundary
figureRight = page content right boundary
```

Candidate upper boundary can be:

- previous paragraph bottom
- previous heading bottom
- top of current column
- page top content margin

V1 can use a conservative crop:

```text
same column or full page width
from previous prose block bottom to caption top
```

### 5.3 Mark Figure Internal Text

Any text line whose bbox overlaps the inferred figure body region should be marked:

```text
type: 'figure_body'
translationPolicy: 'skip'
skipReason: 'figure body text'
```

These blocks should not be rendered as prose.

### 5.4 Create Figure Asset

Render the source PDF page and crop the inferred figure body region.

Save as:

```text
assets/page-<page>-figure-<index>.png
```

Create a `figure_asset` block immediately before the corresponding `figure_caption`.

### 5.5 Fallback Without Cropping

If cropping fails:

- still mark overlapping figure-body text as `figure_body + skip`
- render a small placeholder:

```text
[图表区域已跳过]
```

Do not fall back to showing figure internal text as prose.

## 6. Rendering Strategy

Reader rendering rules:

```text
figure_asset -> render image
figure_caption -> render translated caption
figure_body -> hidden
visual_noise -> hidden
```

If `figure_asset.assetPath` exists, render the image with a max width matching the reading column.

If the asset is missing, render a quiet placeholder instead of raw extracted figure text.

## 7. Translation Strategy

Translator rules:

```text
figure_caption -> translate
figure_asset -> skip
figure_body -> skip
visual_noise -> skip
```

Translation should never receive figure-body text.

Add a secondary guard in the translator:

```ts
if (block.type === 'figure_body' || block.type === 'figure_asset') {
  return keepOriginalAndSkip(block);
}
```

## 8. Heuristics For Figure Body Detection

Text lines are likely figure-body text if they match several of these signals:

- short label plus number, such as `SST2 +23.6`
- many dataset names in a vertical sequence
- axis labels, ticks, or percentages
- high density of numeric values
- repeated short lines without sentence endings
- located between a prose block and a `Figure X.` caption
- large whitespace gaps around the region
- visual alignment patterns, such as many lines sharing similar x positions

These heuristics should not translate the text. They only help decide whether text belongs to the figure body.

## 9. Acceptance Criteria

Using the CLIP PDF figure shown in the test screenshots:

Must not appear as prose:

```text
SST2 +23.6
GTSRB +14.7
SUN397 +6.5
RESISC45 +5.1
FER2013 +4.5
UCF101 +3.1
DTD +0.5
VOC2007 +0.5
STL10 +0.0
-0.8 CIFAR10
-1.7 CIFAR100
```

Must appear:

```text
the original figure screenshot
translated Figure 11 caption
```

Expected reading output:

```text
[bar chart image]

图 11：CLIP 的特征优于最佳模型的特征。
```

## 10. Implementation Order

1. Add `figure_asset` support to block types and renderer.
2. Detect figure captions before heading/paragraph classification.
3. Infer a same-page figure region from caption position.
4. Mark overlapping text lines as `figure_body + skip`.
5. Crop and save figure screenshot assets.
6. Render `figure_asset` before `figure_caption`.
7. Add translator guard for `figure_asset` and `figure_body`.
8. Test on the CLIP PDF screenshots.

## 11. Non-Goals

V1 does not need to:

- translate text inside the figure.
- reconstruct charts as HTML/SVG.
- parse numeric values into structured data.
- perfectly crop every figure in every PDF layout.
- preserve exact original page layout.

The V1 goal is narrower:

```text
do not let figure internals pollute translated prose;
preserve the figure visually when possible.
```
