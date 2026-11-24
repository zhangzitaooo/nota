# Nota

**英文论文，中文读。** Nota 是一款 macOS 论文阅读器。导入 PDF 或粘贴论文链接，就能按原文的章节顺序读中文译文，在段落旁写批注，带着原句向 Agent 提问。

[下载 macOS 版](https://zhangzitaooo.github.io/nota/#get) · [在线试读一篇论文](https://zhangzitaooo.github.io/nota/#inside)

![Nota 阅读器中的中文译文、章节目录和中英对照切换](https://zhangzitaooo.github.io/nota/assets/read.webp)

## 从第一篇论文开始

1. **导入论文。** 在论文库点击「导入论文」，选本地 PDF 或粘贴论文链接。可以导入全文，也可以只选这次要读的几页。
2. **翻译后对照着读。** 点击「翻译全文」，已译好的段落可以先读。章节、图表、图注和公式随正文排布。遇到拿不准的术语，切到「中英对照」，同一句的英文就在旁边。
3. **划下原句，接着问。** 比如读 CLIP 时，看到图里的相似度矩阵，可以划选相关段落，问「为什么对角线上的图文对是正例？」Agent 会收到你的选文和阅读位置。想把自己的理解留下，就在这段写批注，下次点批注可以回到原文。

## 用哪个 Agent？

在「设置 → Agent」里可以选择本机的 Codex、Claude Code 或 WorkBuddy。Codex 和 Claude Code 使用本机登录的账号，WorkBuddy 使用已配置的自定义模型。未安装的 Agent 旁有官方安装指引。

首次打开默认使用内置 Nota Agent，选中论文原句就能提问，无需登录或安装其他助手。当前提供限额试用，额度用完后可以切换到本机 Agent。

## 安装与数据

- **支持的 Mac**：目前提供 Apple 芯片版。0.2.2 是尚未获得 Apple 公证的测试版，macOS 可能阻止首次打开。[查看发布记录](https://github.com/zhangzitaooo/nota/releases)
- **论文和笔记**：论文库、译文、批注和阅读位置保存在这台 Mac 上。导入时 PDF 会上传至 OXR 解析服务。翻译或提问时，所选 Agent 会处理相应的论文内容。

[从源码运行及开发说明](docs/development.md)
