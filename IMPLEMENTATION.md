# 论文精读工作台 V0 实现计划

## 技术栈决定

V0 使用：

- Electron
- React
- TypeScript
- Vite
- DeepSeek API
- pdfjs-dist

选择理由：

- Electron 适合第一版 Mac 本地应用，文件读写、窗口管理、本地项目保存和 API 调用都比较直接。
- React + TypeScript + Vite 适合快速搭建复杂交互界面，包括阅读区、选区标注、进度状态和右侧 Chat。
- DeepSeek API 暂时作为唯一 AI 服务，不做模型切换。
- pdfjs-dist 用于解析文本型 PDF。V0 不处理扫描版 OCR。

## 应用结构

推荐目录结构：

```text
paper-reading-workbench/
  package.json
  electron/
    main.ts
    preload.ts
    services/
      project-store.ts
      pdf-parser.ts
      deepseek-client.ts
      translator.ts
  src/
    app/
      App.tsx
      routes.tsx
    components/
      ReaderPane.tsx
      ChatPane.tsx
      ImportScreen.tsx
      TranslationProgress.tsx
      AnnotationToolbar.tsx
    domain/
      document.ts
      annotations.ts
      chat.ts
    styles/
      app.css
  sample/
    clip.pdf
```

Electron main process 负责：

- 打开文件选择器。
- 读取 PDF。
- 创建和保存论文项目。
- 调用 DeepSeek API。
- 暴露安全的 IPC 接口给 renderer。

React renderer 负责：

- 导入入口。
- 翻译进度展示。
- 阅读型 HTML 渲染。
- 选中、高亮、加粗。
- 右侧 Chat 输入和消息展示。

## 本地项目保存

默认项目保存目录：

```text
~/Documents/PaperReadingWorkbench/projects/<paper-id>/
```

单篇论文项目结构：

```text
<paper-id>/
  source.pdf
  document.json
  annotations.json
  chats.json
  meta.json
```

`paper-id` 可先使用导入时间戳加文件名 slug，例如：

```text
2026-05-27-clip-learning-transferable-visual-models
```

## 数据模型

### Document

```ts
type PaperDocument = {
  paper: {
    id: string;
    title: string;
    sourcePdfPath: string;
    createdAt: string;
    updatedAt: string;
  };
  blocks: PaperBlock[];
};

type PaperBlock = {
  id: string;
  type: "title" | "heading" | "paragraph" | "figure_caption" | "formula" | "reference";
  sectionPath: string[];
  page?: number;
  order: number;
  en: string;
  zh: string;
  status: "pending" | "translating" | "done" | "failed";
  error?: string;
};
```

### Annotation

```ts
type Annotation = {
  id: string;
  blockId: string;
  type: "highlight" | "bold";
  start: number;
  end: number;
  selectedText: string;
  createdAt: string;
  updatedAt: string;
};
```

### Chat

```ts
type ChatThread = {
  id: string;
  blockId: string;
  selectedText: string;
  context: {
    paperTitle: string;
    sectionPath: string[];
    zhBlock: string;
    enBlock: string;
  };
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
```

## DeepSeek API

V0 只支持 DeepSeek API。

API key 读取方式：

1. 开发期优先读取项目根目录 `.env.local` 中的 `DEEPSEEK_API_KEY`。
2. 应用内设置页暂不做。
3. 不支持多模型切换。

调用位置：

- 所有 DeepSeek 请求都从 Electron main process 发起。
- Renderer 不直接接触 API key。

建议模型：

- 翻译：`deepseek-chat`
- Chat：`deepseek-chat`

如果后续需要更强推理，再单独评估。

## PDF 解析

V0 支持文本型 PDF。

解析目标：

- 提取文本。
- 尽量恢复阅读顺序。
- 按标题和自然段拆分为 blocks。
- 保留页码信息。

V0 不处理：

- 扫描版 PDF OCR。
- 复杂公式重建。
- 1:1 双栏版式还原。
- PDF 坐标级高亮。

双栏处理策略：

- 先使用 pdfjs-dist 获取每页 text items。
- 根据 y 坐标聚合成行。
- 根据 x 坐标粗略判断左右栏。
- 按左栏从上到下、右栏从上到下合并。
- 如果解析失败，允许先以较粗糙的段落顺序进入后续翻译。

## 翻译流程

导入 PDF 后，流程为：

1. 复制 PDF 到本地项目目录。
2. 解析 PDF 为英文 blocks。
3. 创建 `document.json`，所有 blocks 初始为 `pending`。
4. 逐段调用 DeepSeek 翻译。
5. 每段翻译完成后立即写入 `document.json`。
6. Renderer 实时显示整体进度和当前段落状态。
7. 失败段落标记为 `failed`，允许重试。

翻译提示词要求：

- 直接翻译成中文。
- 保留论文术语和专有名词。
- 不添加额外摘要、解释、导读。
- 不改写为口语化科普。
- 保留引用标记、变量名和公式标识。

示例系统提示：

```text
你是一个学术论文翻译助手。请将英文论文段落翻译为准确、自然的中文。
要求：
1. 只输出译文，不输出解释。
2. 保留论文术语、变量名、引用标记和公式编号。
3. 不添加原文没有的信息。
4. 不生成摘要或导读。
5. 中文表达应适合精读，不要过度口语化。
```

## 阅读区交互

左侧阅读区默认只显示中文。

每个 block 渲染为一个带 `data-block-id` 的 HTML 节点。

选中文本后显示浮动工具条：

- 高亮。
- 加粗。
- 问 AI。
- 取消。

高亮和加粗不直接修改原始 `zh` 字符串，而是保存 annotation range。渲染时根据 annotations 叠加样式。

V0 中，如果一个选区跨越多个 block，可以先提示用户只选择单个段落内文本。

## AI Chat 交互

右侧 Chat 窗口常驻。

当用户点击「问 AI」或选中文本后聚焦 Chat：

1. 系统识别选区所在 block。
2. 读取选中文本。
3. 自动构造上下文。
4. 输入框显示用户可编辑的问题区域。

发送给 DeepSeek 的上下文包括：

- 论文标题。
- 章节路径。
- 选中的中文译文。
- 完整中文段落。
- 对应英文原文。
- 用户补充的问题。

Chat 回答保存到 `chats.json`。

## V0 用户故事

1. 用户打开 Mac 应用，看到导入 PDF 的入口。
2. 用户选择一篇英文 PDF。
3. 应用创建本地论文项目，并显示解析和翻译进度。
4. 翻译过程中，已完成段落可以先出现在阅读区。
5. 用户在左侧阅读中文译文。
6. 用户选中一段中文，可以高亮或加粗。
7. 用户关闭应用后重新打开，标注仍然存在。
8. 用户选中一段中文并在右侧提问，AI 能基于选区、完整段落和英文原文回答。

## 验收标准

V0 完成时应满足：

- 可以在 MacBook 上以 Electron 应用形式运行。
- 可以导入一篇文本型英文 PDF。
- 可以解析出可阅读的段落 blocks。
- 可以逐段翻译，并显示翻译进度。
- 翻译完成后，左侧显示中文译文阅读区。
- 可以对单个段落内选中文本做高亮。
- 可以对单个段落内选中文本做加粗。
- 标注保存后，重启应用仍能恢复。
- 右侧 Chat 可以基于选区提问。
- DeepSeek API key 不暴露给 renderer。

## V0 非目标

- 不支持扫描版 PDF OCR。
- 不支持多模型配置。
- 不支持 Notion 同步。
- 不支持 PDF 坐标标注。
- 不支持复杂引用管理。
- 不支持多人协作。
- 不支持跨论文知识库检索。

## 推荐实现顺序

1. 初始化 Electron + React + TypeScript + Vite 项目。
2. 完成主窗口和双栏布局。
3. 完成 PDF 导入和项目目录创建。
4. 接入 pdfjs-dist，生成英文 blocks。
5. 写入和读取 `document.json`。
6. 接入 DeepSeek，完成逐段翻译。
7. 渲染中文阅读区。
8. 实现单段选区识别。
9. 实现高亮和加粗 annotations。
10. 实现 annotations 持久化。
11. 实现右侧 Chat UI。
12. 实现选区上下文拼接和 DeepSeek 问答。
13. 用固定论文样本做端到端验证。

## 建议测试样本

第一篇样本使用 CLIP 论文：

```text
Learning Transferable Visual Models From Natural Language Supervision
```

这篇论文有双栏、图表、引用和较典型的机器学习论文结构，适合作为 V0 验证样本。
