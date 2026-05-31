# Figma 视觉对齐开发计划 Spec

## 1. 文档定位

这份 spec 用于指导「论文精读工作台」第二阶段开发：在不破坏现有核心功能的前提下，对齐 Figma 设计稿中的产品形态、页面布局和阅读体验。

它和已有文档的区别：

- `README.md`：定义产品定位、MVP 边界和长期方向。
- `IMPLEMENTATION.md`：定义 V0 从零实现的技术栈、数据模型和功能闭环。
- `FIGMA_ALIGNMENT_DEV_SPEC.md`：定义已有 V0 雏形之后，如何按 Figma 视觉稿做工程化迭代。

本阶段不是推倒重写，而是在现有 Electron + React + TypeScript 项目上做分层重构。

## 2. 当前基线

当前项目已经具备以下功能：

- Mac 本地 Electron 应用。
- PDF 导入。
- PDF 文本解析为结构化 blocks。
- 解析完成后立即进入阅读器。
- DeepSeek 后台逐段翻译。
- 阅读区实时展示已完成译文，未完成段落显示原文占位。
- 选中文本后出现浮动工具栏。
- 对译文做高亮和加粗标注。
- 基于选区和 block 上下文向 AI 提问。
- 标注和 Chat 记录本地持久化。

本阶段所有开发必须保护这些功能不回退。

## 3. 设计稿来源

当前 PRD 视觉稿位置：

```text
/Users/zhangzitao/Documents/PM/projects/论文阅读器 PRD.md
```

设计稿覆盖页面：

- 启动页。
- 阅读页默认状态。
- 文字标记态。
- 文字选中态。
- 侧边栏展开态。

后续如果接入 Figma，应将 Figma 信息补充到本节：

```text
Figma link: https://www.figma.com/design/GjP5GCCjG7yBeCkjyBsiJ5/Untitled?node-id=0-1&t=Z6qsE10Jwwz2LKkK-1
Frame names: 待从 Figma 或导出截图确认
Design token source: 当前先按 PRD 截图抽取；待 Dev Mode 标注校准
Exported assets path: 待补充
```

当前限制：Codex 暂时无法直接读取该 Figma 画布的节点细节，因此第一轮开发以 `projects/论文阅读器 PRD.md` 中的导出截图为准。若后续提供 Figma frame 导出图、Dev Mode 标注或 SVG/icon 资产，应以 Figma 为最终视觉来源更新本 spec。

## 4. 开发原则

### 4.1 功能稳定优先

视觉改动不得破坏以下链路：

1. 导入 PDF。
2. 创建本地项目。
3. 解析 blocks。
4. 进入阅读器。
5. 后台翻译并实时更新 UI。
6. 选区识别。
7. 高亮/加粗标注。
8. AI Chat 上下文构造。
9. 本地保存和恢复。

每个阶段完成后都需要按验收清单检查。

### 4.2 分层改造

优先把样式、布局、组件职责拆清楚，再逐步贴近 Figma。

推荐分层：

- `domain/`：数据结构和纯函数，不混入 UI 样式逻辑。
- `components/`：页面组件和交互组件。
- `styles/` 或 CSS sections：设计 token、布局、阅读排版、Chat 样式。
- `electron/services/`：本地项目、PDF、翻译、AI 请求。

### 4.3 小步提交

每个开发阶段应能独立运行、独立验收。

不要把启动页、阅读器、Chat、项目列表、导出能力放在一次大改里。

## 5. 目标产品形态

### 5.1 启动页

目标体验：

- 页面极简，中心是「导入论文」主入口。
- 下方显示最近打开或导入过的文件。
- 文件列表点击后可进入对应阅读项目。

V0.1 可以先做静态最近项目列表读取；不要求完整项目管理。

关键状态：

- 空状态：仅显示导入入口。
- 有项目：显示最近项目列表。
- 导入中：显示解析/翻译创建状态。
- 导入失败：显示错误反馈，可返回重试。

### 5.2 阅读页默认状态

目标体验：

- 顶部栏显示菜单入口、论文名称、导出按钮。
- 左侧为中文译文阅读区，是视觉主内容。
- 右侧为 AI Chat 区，不抢占阅读主体。
- 正文排版接近论文阅读体验：大留白、清晰标题层级、舒适行高。

当前工程版中的顶部翻译进度条应被保留，但视觉上需要更轻，不破坏 Figma 的干净阅读感。

### 5.3 文字标记态

目标体验：

- 高亮是浅黄色文本背景。
- 加粗用于重点概念，不改变段落结构。
- 标注应稳定绑定到译文 block range。

V0 不做多颜色标注、不做批注气泡、不做标注列表。

### 5.4 文字选中态

目标体验：

- 用户选中文本后，保留浏览器系统选区视觉。
- 选中后右侧 Chat 输入框直接出现上下文胶囊，用户不需要点击「问 AI」。
- 浮动工具栏贴近选区上方。
- 工具栏只提供高亮、加粗。
- 如果选区处于未翻译英文占位段落，只更新 Chat 胶囊，不允许高亮/加粗。

选区跨 block 时，V0 仍更新 Chat 胶囊，但不展示高亮/加粗工具栏，避免产生跨 block 标注范围错误。

### 5.5 侧边栏展开态

目标体验：

- 左侧文件栏可展开，展示文件列表和导入入口。
- 展开后阅读区整体让出空间，不遮挡正文。
- 当前文件有选中态。

V0.1 可以只做展开/收起和最近项目列表；不做文件夹、多选、删除、搜索。

## 6. Figma 接入方式

Codex 可以基于 Figma 进行开发，但需要以下任一输入：

### 6.1 推荐输入

- Figma 可访问链接。
- 关键 frame 名称。
- 设计稿截图或 Dev Mode 标注。
- 字体、颜色、间距、圆角、阴影信息。

### 6.2 可接受输入

- 从 Figma 导出的 PNG 截图。
- 图标 SVG。
- 组件状态截图。

### 6.3 资产落地规则

如果 Figma 有导出资产，应放到：

```text
src/assets/
```

如果只是图标，优先使用现有 icon 方案或内联 SVG；不要为了少量图标引入大型 UI 库。

设计 token 优先落到 CSS variables：

```css
:root {
  --color-bg: ...;
  --color-text: ...;
  --space-page-x: ...;
  --reader-width: ...;
}
```

## 7. 组件拆分计划

当前 `App.tsx` 和 `App.css` 已经承担较多职责。视觉对齐前建议逐步拆分。

### 7.1 页面级组件

建议新增：

```text
src/components/AppShell.tsx
src/components/ProjectHome.tsx
src/components/ReadingWorkspace.tsx
src/components/ProjectSidebar.tsx
```

职责：

- `AppShell`：窗口级布局、顶栏、全局状态入口。
- `ProjectHome`：启动页和最近项目。
- `ReadingWorkspace`：阅读页整体布局。
- `ProjectSidebar`：文件侧栏展开/收起和项目列表。

### 7.2 阅读组件

保留并强化：

```text
src/components/ReaderPane.tsx
```

可新增：

```text
src/components/SelectionToolbar.tsx
src/components/TranslationStatusStrip.tsx
```

职责：

- `ReaderPane`：只负责 block 渲染、选区识别、标注事件。
- `SelectionToolbar`：只负责浮动工具条展示。
- `TranslationStatusStrip`：只负责后台翻译状态展示。

### 7.3 Chat 组件

保留：

```text
src/components/ChatPane.tsx
```

后续可拆：

```text
src/components/ChatMessages.tsx
src/components/ChatComposer.tsx
src/components/SelectedContextPill.tsx
```

## 8. 数据和状态规范

### 8.1 不改动底层数据模型

本阶段默认不重构 `PaperDocument`、`PaperBlock`、`Annotation`、`ChatThread` 的核心字段。

允许新增 UI 状态：

- sidebar collapsed / expanded。
- active project id。
- translation status summary。
- current selection state。

不允许把 UI-only 状态写入 `document.json`。

### 8.2 项目列表

启动页文件列表应来自本地项目目录，而不是写死。

依赖现有 Electron API：

- `listProjects`
- `loadProject`
- `loadDocument`

如果现有 API 不足，再补 main/preload IPC。

## 9. 开发阶段

### Phase 0：验收基线和设计 token

目标：

- 创建验收清单。
- 抽出 CSS variables。
- 不明显改变现有功能。

任务：

- 新建 `ACCEPTANCE_CHECKLIST.md`。
- 整理 `App.css` 中颜色、间距、字体变量。
- 标记当前功能基线。

验收：

- `npm run build` 通过。
- Electron dev 可打开。
- 导入、后台翻译、选区、标注、AI Chat 不回退。

### Phase 1：启动页对齐

目标：

- 对齐 Figma 启动页。
- 增加最近项目列表入口。

任务：

- 重做 `ImportScreen` 为 Figma 风格。
- 接入 `listProjects`。
- 支持点击最近项目进入阅读页。

验收：

- 无项目时可导入。
- 有项目时显示最近文件。
- 点击项目可恢复 document、annotations、chats。

### Phase 2：阅读页外壳对齐

目标：

- 对齐顶部栏、阅读区、AI 侧栏布局。
- 保留翻译状态轻提示。

任务：

- 新建或拆分 `ReadingWorkspace`。
- 实现顶部栏：菜单、标题、导出按钮占位。
- 调整阅读区宽度、右侧栏宽度、分割线、留白。
- 翻译状态条改为轻量样式。

验收：

- 后台翻译时仍能阅读已完成段落。
- 右侧 Chat 不遮挡阅读区。
- 窗口缩放时文本不重叠。

### Phase 3：阅读排版和选区工具栏对齐

目标：

- 正文排版贴近 Figma。
- 标注/选区交互稳定。

任务：

- 调整标题、作者、摘要、正文、引用的字体和行高。
- 调整高亮色和加粗表现。
- 将 SelectionToolbar 独立为组件。
- 跨 block 选区更新 Chat 胶囊，但隐藏高亮/加粗工具栏。

验收：

- 单段内选区工具栏稳定出现。
- 工具栏贴近选区上方。
- 高亮/加粗后刷新仍存在。
- 未翻译段落只更新 Chat 胶囊，不允许标注。

### Phase 4：AI Chat 视觉对齐

目标：

- 对齐 Figma 右侧 AI 对话。
- 保持现有上下文能力。

任务：

- 重做 Chat 输入框、发送按钮、消息气泡。
- 选区上下文显示为 pill/chip。
- Assistant 消息支持复制。
- 空状态更轻。

验收：

- 选区后右侧显示上下文。
- 输入问题后可发送。
- AI 请求仍包含 zh selection、zh block、en block、sectionPath、paper title。
- Chat 记录持久化。

### Phase 5：导出占位和后续规划

目标：

- 处理 Figma 中的导出入口。
- 避免 V0 过早扩大范围。

任务：

- 顶栏显示导出按钮。
- V0 可先弹出「暂未支持」或只导出当前 HTML/Markdown。
- 如果要实现导出，另开 spec。

验收：

- 导出按钮不影响现有阅读链路。
- 不把导出混入视觉对齐主任务。

## 10. 验收清单草案

每次阶段完成后必须检查：

- `npm run build` 通过。
- `./node_modules/.bin/tsc -p tsconfig.electron.json` 通过。
- Electron dev 能启动。
- 可以导入 `sample/clip.pdf`。
- 解析完成后立即进入阅读页。
- 后台翻译继续推进。
- 已翻译段落显示中文。
- 未翻译段落显示英文占位。
- 选中译文后工具栏出现。
- 选中文本后 Chat 输入框直接出现上下文胶囊。
- 跨段选区不展示高亮/加粗工具栏，但仍可用胶囊向 AI 提问。
- 高亮和加粗可保存。
- 选中内容可带入 Chat。
- Chat 能调用 DeepSeek 并保存记录。
- 关闭重开后项目数据可恢复。

## 11. 非目标

本阶段不做：

- OCR。
- PDF 坐标标注。
- 多模型切换。
- Notion 同步。
- 多颜色标注。
- 复杂导出。
- 多论文知识库问答。
- 账号系统或云同步。

## 12. 待确认问题

以下问题需要在进入对应 Phase 前确认：

1. Figma 设计稿链接和访问方式是什么？
2. 启动页最近文件列表是否需要支持删除项目？
3. 左侧文件栏是否默认折叠？
4. 右侧 AI Chat 是否允许完全隐藏？
5. 导出按钮在 V0 是否只是占位？
6. 是否需要保留当前顶部翻译进度条，还是改为更弱的状态提示？
