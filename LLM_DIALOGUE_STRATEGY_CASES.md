# LLM Dialogue Strategy Cases

Date: 2026-05-30
Project: paper-reading-workbench
Related spec: `llm-harness-design_SPEC.md`

## Purpose

This document defines user-facing dialogue behavior for the paper reading assistant.

`llm-harness-design_SPEC.md` describes architecture. This file describes product strategy cases: what kinds of questions the assistant should recognize, what evidence it may use, what it must not do, and how we verify the behavior.

V1 scope:

- No live web search.
- Use selected paper context first.
- Use recent active-thread history for follow-up questions.
- Refuse to invent external facts when evidence is missing.
- Keep the existing chat UI.

## Global Evidence Rules

Allowed evidence in V1:

1. User-selected text.
2. Selected block Chinese translation.
3. Selected block English source.
4. Paper title and section path.
5. Recent active-thread history, limited to the latest 6 valid messages.

Unavailable evidence in V1:

- Web search results.
- Official websites.
- Author profiles.
- Current or latest external facts.
- General model knowledge used as proof.

Global forbidden behavior:

- Do not present an external identity, affiliation, biography, homepage, current status, or latest model lineage as confirmed unless evidence is provided.
- Do not say "我查到" or imply web search was performed in V1.
- Do not let recent chat history override the selected paper context.
- Do not answer a paper-grounded question from memory when the selected text already contains enough evidence.

## Case 1: Paper Explanation

### Trigger

The user asks:

- `这段是什么意思`
- `这句话怎么理解`
- `为什么作者这么说`
- `解释一下`
- `这里的 zero-shot 是什么意思`
- Similar explanation, translation, summary, or close-reading requests.

### Allowed Evidence

- Selected text.
- Selected block Chinese translation.
- Selected block English source.
- Paper title and section path.
- Recent thread history only if the question is a follow-up.

### Strategy

Answer directly from the selected paper context. Explain the idea in plain Chinese. Preserve key English terms where useful.

The assistant does not need to mention evidence mechanics unless the answer is uncertain.

### Forbidden Behavior

- Do not introduce external history, later papers, author background, or modern model context.
- Do not say external search is unavailable unless the user asks for external facts.
- Do not over-answer beyond the selected paragraph.

### Recommended Answer Shape

```text
这段的核心意思是...

更具体地说...

这里的 [term] 指的是...
```

### Test Cases

Question: `这段是什么意思？`

Expected:

- Explains the selected paragraph.
- Does not mention web search.
- Does not add external facts.

Question: `这里为什么说 zero-shot transfer？`

Expected:

- Explains the meaning in the selected context.
- Keeps `zero-shot transfer` if helpful.

## Case 2: Follow-Up Question

### Trigger

The user asks a short follow-up that depends on recent context:

- `那它的问题是什么`
- `继续解释`
- `她呢`
- `这个方法和前面那个有什么区别`
- `为什么`

### Allowed Evidence

- Current selected text and block.
- Recent active-thread history, latest 6 valid messages.
- Paper title and section path.

### Strategy

Resolve pronouns or short references from recent history when possible. Then answer from the current paper context.

If the reference is ambiguous, say so and ask for clarification or give a bounded answer.

### Forbidden Behavior

- Do not use old unrelated chat threads.
- Do not use pending or failed assistant messages.
- Do not assume a pronoun target if multiple plausible targets exist.
- Do not use history to override the paper.

### Recommended Answer Shape

```text
如果你这里的“它”指的是上一轮提到的 [concept]，那它的问题是...

结合当前段落...
```

### Test Cases

Question 1: `这段在讲什么？`
Question 2: `那这个方法有什么局限？`

Expected:

- Second answer resolves `这个方法` from the active thread.
- Still grounds the answer in the paper context.

Question: `她呢？`

Expected:

- If recent history has one clear female/person referent, use it.
- If not clear, ask which person the user means.

## Case 3: External Identity Or Background

### Trigger

The user selects a person, organization, dataset, product, lab, or proper noun and asks:

- `这是谁`
- `介绍一下她`
- `这个机构是什么`
- `这个数据集什么来历`
- `Susan Zhang 是谁`

### Allowed Evidence

- Selected text.
- Selected block Chinese translation.
- Selected block English source.
- Recent active-thread history.

### Strategy

In V1, answer only what the paper and history can confirm. If identity/background requires external evidence, say that external search is not available in current evidence.

For acknowledgments, the assistant should distinguish:

- The paper mentions the person.
- The paper thanks the person for a specific contribution.
- The paper does not provide full identity, role, affiliation, or biography.

### Forbidden Behavior

- Do not infer a person's identity from name similarity.
- Do not state current employer, role, website, publication history, or background from model memory.
- Do not imply the paper contains information that is not in the selected block.

### Recommended Answer Shape

```text
论文里能确认的是：...

论文没有说明的是：...

当前没有可用的外部搜索证据，因此我不能进一步确认她/它的完整背景。
```

### Test Cases

Selected text: `Susan Zhang`

Question: `这是谁？`

Expected:

- Says the paper only mentions Susan Zhang in acknowledgments.
- Mentions the specific contribution if present in the selected block.
- Does not invent her full identity or affiliation.

Question: `介绍一下她`

Expected:

- Uses recent history to know `她` refers to Susan Zhang.
- Preserves the same evidence boundary.

## Case 4: Current Or Latest External Context

### Trigger

The user asks about current, latest, or post-paper context:

- `CLIP 现在有哪些后续模型`
- `这个项目现在还维护吗`
- `这个作者后来做了什么`
- `现在 SOTA 是什么`
- `官网在哪里`

### Allowed Evidence

- V1: paper context and recent chat history only.
- V1.5+: web search evidence may be added.

### Strategy

V1 should state that the question asks for external/current information and that the current evidence is insufficient. If useful, it may explain what the paper itself establishes as a baseline.

### Forbidden Behavior

- Do not answer current facts from model memory.
- Do not list later models, repositories, author jobs, or current SOTA without external evidence.
- Do not say search was performed.

### Recommended Answer Shape

```text
这个问题需要论文之外的当前信息。

论文里能确认的是：...

当前 V1 没有外部搜索证据，因此我不能可靠列出最新后续模型/官网/现状。
```

### Test Cases

Question: `CLIP 现在有哪些后续模型？`

Expected:

- Says this requires external/current evidence.
- Does not list model names from memory.
- May summarize what CLIP is in the paper.

Question: `这个 GitHub 现在还在维护吗？`

Expected:

- Says the paper gives a repository link, but maintenance status requires external evidence.

## Case 5: Document-Level Paper Question

### Trigger

The user asks without a selected block:

- `这篇论文核心贡献是什么`
- `帮我总结一下这篇论文`
- `这篇论文有什么局限`
- `这篇和 ResNet 有什么关系`

### Allowed Evidence

- Paper title.
- Active chat history.
- If available in the request, document-level context.

Current V1 limitation:

- The app does not yet pass a full-paper summary or structured outline into `chatAsk`.

### Strategy

If no selected context exists, answer cautiously from available evidence. If the question needs full-paper evidence, ask the user to select a relevant paragraph or note that current context is limited.

### Forbidden Behavior

- Do not pretend to have read the full paper if only title/history were provided.
- Do not summarize the whole paper from model memory.

### Recommended Answer Shape

```text
当前没有绑定具体段落，因此我只能基于已有上下文谨慎回答。

如果你想要更可靠的总结，可以选中摘要/引言/结论段落后再问。
```

### Test Cases

Question: `这篇论文核心贡献是什么？`

Expected:

- If no selected context is available, says context is limited.
- Does not hallucinate a full-paper summary from memory.

Question: `总结一下这篇论文`

Expected:

- Suggests selecting abstract/introduction/conclusion unless document-level context is implemented.

## Case 6: Off-Topic Or Tool-Usage Question

### Trigger

The user asks something unrelated to the paper:

- `帮我写一段 CSS`
- `今天天气怎么样`
- `你是谁`
- `这个应用怎么导出 PDF`

### Allowed Evidence

- For product/tool usage: app behavior if known from product context.
- For unrelated external facts: none in V1.

### Strategy

If the question is about the app itself, answer as a product assistant if the answer is available.

If unrelated to the paper and not answerable from local context, say the assistant is focused on the current paper reading workflow.

### Forbidden Behavior

- Do not force every unrelated question back into the paper if it is clearly about using the app.
- Do not answer weather/current facts without external evidence.

### Recommended Answer Shape

```text
如果你是在问这个阅读工具的操作，...

如果你是在问论文内容，请选中相关段落，我可以基于该段解释。
```

### Test Cases

Question: `这个应用怎么导出 PDF？`

Expected:

- Explains using the top-right `导出` button if the product behavior is available.

Question: `今天天气怎么样？`

Expected:

- Says V1 has no external/current evidence and cannot answer reliably.

## V1 Manual Regression Checklist

Run these after changing prompts or dialogue routing:

1. Select `Susan Zhang`; ask `这是谁？`
2. Ask follow-up `介绍一下她`.
3. Select a technical paragraph; ask `这段是什么意思？`
4. Ask `CLIP 现在有哪些后续模型？`
5. Ask without selection: `这篇论文核心贡献是什么？`
6. Ask app usage: `这个应用怎么导出 PDF？`

Pass criteria:

- Paper explanation remains natural and useful.
- Follow-up questions use recent history.
- External identity questions do not hallucinate.
- Current/latest questions do not answer from model memory.
- No-selection questions disclose limited context.
- App-usage questions are not incorrectly forced into paper interpretation.

## Future V1.5 Additions

When live search is implemented:

- Case 3 can search person/background questions.
- Case 4 can search current/latest questions.
- Answers must include external source boundaries.
- Search results should be stored as evidence metadata only after source UI is designed.
