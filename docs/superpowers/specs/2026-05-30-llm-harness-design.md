# LLM Harness Design

Date: 2026-05-30
Project: paper-reading-workbench

## Summary

Add a lightweight LLM harness for the AI chat feature. The harness should make the assistant more evidence-aware: it should answer from the selected paper context when possible, use chat history for follow-up questions, automatically search the web when the user asks for external facts, and clearly state uncertainty instead of guessing.

This is a dialogue-management feature, not a full agent framework. The first version should be small, inspectable, and easy to tune through versioned Markdown policy files.

## Goals

- Move chat behavior out of one hard-coded prompt and into a small LLM harness.
- Add a stable assistant identity through `soul.md`.
- Add explicit policies for grounding, chat history, web search, uncertainty, and answer style.
- Automatically trigger web search for questions that need external evidence.
- Preserve the user's selected paper context as the primary evidence source.
- Use recent thread history for follow-up questions.
- Distinguish clearly between:
  - what the paper says,
  - what prior conversation established,
  - what external search found,
  - what remains uncertain.
- Keep the implementation understandable inside the existing Electron service structure.

## Non-Goals

- Do not build a general-purpose autonomous agent.
- Do not add multi-step planning loops in v1.
- Do not let the model freely decide to call arbitrary tools.
- Do not require a new backend server.
- Do not redesign the chat UI beyond the minimum needed to show search/citation state.
- Do not solve PDF parsing or translation quality issues in this feature.
- Do not make every question use web search.

## Current Code Context

The current chat flow is simple:

- `src/App.tsx` chooses chat scope from `selectedBlockId`, `activeChatId`, or `__document__`.
- A `ChatThread` is reused by `blockId + selectedText`.
- `ChatThread.messages` are saved locally in `chats.json`.
- `window.electronAPI.chatAsk(...)` sends only the current question plus paper context.
- `electron/services/deepseek-client.ts` builds a fixed paper-assistant prompt and calls `deepseek-chat`.
- Stored chat history is not sent back to the model.
- There is no web search service, citation layer, or explicit uncertainty policy.

This creates the current failure mode: if the selected text is a person name such as `Susan Zhang`, the model receives local paper context and may infer a broader identity without external evidence.

## Design Principle

The assistant should not behave as if every answer comes from one undifferentiated context window. It should know which evidence source supports each claim.

The harness should treat answers as evidence composition:

```text
question
  -> route evidence needs
  -> collect paper context
  -> collect recent chat history
  -> optionally collect web search evidence
  -> compose answer with source boundaries
```

## Proposed File Structure

```text
llm/
  soul.md
  policies/
    grounding.md
    web-search.md
    chat-history.md
    uncertainty.md
    answer-style.md
  prompts/
    route-question.md
    compose-answer.md

electron/services/
  llm-harness.ts
  dialogue-manager.ts
  web-search-service.ts
```

The Markdown files define product behavior. The TypeScript services enforce execution boundaries.

## Policy Files

### `llm/soul.md`

Defines the assistant's durable identity:

- It is a paper reading assistant, not a generic chatbot.
- It helps the user understand academic papers precisely.
- It prefers grounded answers over fluent speculation.
- It can use external sources when the paper does not contain enough information.
- It must keep paper evidence and web evidence separate.

Example policy language:

```md
You are the AI assistant inside a paper reading workbench.
Your job is to help the user understand the paper they are reading.
When the paper does not contain enough information, say so and use approved external evidence if available.
Never present an external fact as if it came from the paper.
```

### `llm/policies/grounding.md`

Defines evidence priority:

1. User-selected text.
2. Selected block Chinese translation.
3. Selected block English source.
4. Section path and paper title.
5. Recent chat history in the same thread.
6. Web search results.

Rules:

- Use paper evidence first for interpretation questions.
- Do not invent details missing from the paper.
- When the selected block is sparse, say the paper only provides limited evidence.
- If a claim comes from web search, label it as external.

### `llm/policies/web-search.md`

Defines automatic search triggers.

Search should trigger when the question asks for:

- a person's identity or background,
- an institution, company, lab, dataset, project, or product,
- a paper, author homepage, official repository, or external publication,
- recent or current information,
- facts not normally inferable from the selected paragraph,
- phrases such as `这是谁`, `介绍一下`, `背景`, `主页`, `现在`, `官网`, `是谁做的`, `有什么来历`.

Search should not trigger when the question is clearly answerable from the paper context, such as:

- translate this sentence,
- explain this paragraph,
- summarize this section,
- what does this term mean in this sentence,
- compare two statements already present in the selected block.

Search results must be structured before answer composition:

```ts
interface WebSearchEvidence {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    sourceType: 'official' | 'paper' | 'profile' | 'news' | 'other';
  }>;
  searchedAt: string;
}
```

### `llm/policies/chat-history.md`

Defines history usage:

- Include the latest messages from the active `ChatThread`.
- Use history to resolve follow-up questions such as `她`, `这个方法`, `继续解释`.
- Do not let history override the selected paper context.
- Do not include every old message; use a bounded recent window.

Recommended v1 window:

- Last 6 user/assistant messages from the active thread.
- Exclude pending or errored assistant messages.

### `llm/policies/uncertainty.md`

Defines uncertainty behavior:

- If the paper does not say something, state that directly.
- If web search was used, separate the result from the paper evidence.
- If search results are weak or conflicting, say they are weak or conflicting.
- If no reliable result is found, say:

```text
论文里没有说明这一点；我也没有找到可靠的外部来源来确认。
```

For mixed evidence, prefer this structure:

```text
论文里能确认的是...
论文没有说明的是...
外部搜索显示...
仍不确定的是...
```

### `llm/policies/answer-style.md`

Defines presentation:

- Reply in Chinese by default.
- Keep short questions concise.
- Preserve English technical terms when helpful.
- Do not over-explain source mechanics unless the source boundary matters.
- For external evidence, include source titles or links when available.
- For low-confidence answers, use careful wording instead of confident claims.

## Prompt Files

### `llm/prompts/route-question.md`

Used by the dialogue manager when rules are not enough.

Input:

- paper title,
- section path,
- selected text,
- selected block summary,
- recent chat history summary,
- user question.

Output should be strict JSON:

```json
{
  "questionType": "paper_explanation | follow_up | external_fact | mixed | other",
  "needsWebSearch": true,
  "searchQueries": ["Susan Zhang OpenAI CLIP"],
  "reason": "The user asks for a person's identity, and the selected paragraph only mentions the person in acknowledgments."
}
```

The model router is advisory. Code-level rules can force web search for high-confidence trigger patterns.

### `llm/prompts/compose-answer.md`

Used to produce the final answer after evidence collection.

The composer receives:

- `soul.md`,
- relevant policies,
- paper context,
- recent chat history,
- web search evidence if any,
- route decision,
- user question.

It must produce the final user-facing answer and obey evidence boundaries.

## Runtime Architecture

### `llm-harness.ts`

Responsibilities:

- Load `llm/soul.md`.
- Load policy files.
- Load prompt templates.
- Build system and user messages for router and composer calls.
- Keep prompt assembly in one place.

Suggested API:

```ts
export class LlmHarness {
  buildRouteMessages(input: RouteInput): ChatMessage[];
  buildComposeMessages(input: ComposeInput): ChatMessage[];
}
```

### `dialogue-manager.ts`

Responsibilities:

- Accept the chat request from the IPC handler.
- Attach recent chat history.
- Apply deterministic search-trigger rules.
- Ask the router model only for ambiguous cases.
- Call `web-search-service` when needed.
- Call `DeepSeekClient` or a generic model client for final composition.
- Return a structured answer payload.

Suggested API:

```ts
export class DialogueManager {
  async answer(input: DialogueInput): Promise<DialogueAnswer>;
}
```

### `web-search-service.ts`

Responsibilities:

- Execute web search queries.
- Normalize search results into `WebSearchEvidence`.
- Prefer reliable source types when possible.
- Return empty evidence when search fails.

The first implementation should target a simple HTTP search provider configured through environment variables. Brave Search is the default v1 target, but the dialogue manager should depend on an interface rather than provider-specific code.

Suggested API:

```ts
export interface WebSearchService {
  search(query: string): Promise<WebSearchEvidence>;
}
```

## Data Contracts

### Chat Request

Current request:

```ts
{
  paperTitle: string;
  sectionPath: string[];
  selectedText: string;
  zhBlock: string;
  enBlock: string;
  question: string;
}
```

Proposed request:

```ts
interface DialogueInput {
  paperTitle: string;
  sectionPath: string[];
  selectedText: string;
  zhBlock: string;
  enBlock: string;
  question: string;
  chatHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

### Chat Response

Current response is a string.

Proposed response:

```ts
interface DialogueAnswer {
  content: string;
  evidence: {
    usedPaperContext: boolean;
    usedChatHistory: boolean;
    usedWebSearch: boolean;
    searchQueries: string[];
    sources: Array<{
      title: string;
      url: string;
      sourceType: string;
    }>;
  };
  uncertainty: {
    paperHadAnswer: boolean;
    externalEvidenceFound: boolean;
    notes: string[];
  };
}
```

For v1, the renderer can still store `content` as the assistant message. The evidence metadata can be added to `ChatMessage` in a follow-up if the UI needs source chips.

## User Experience

For paper-only answers:

```text
这句话的意思是...
```

For mixed paper plus web answers:

```text
论文里能确认的是：Susan Zhang 在致谢中被提到，作者感谢她在图像条件语言模型研究上的贡献。

论文没有说明的是：她的完整身份、职位或个人背景。

外部搜索显示：...
```

For failed search:

```text
论文里没有提供足够信息确认她是谁。我也没有找到可靠的外部来源来补充这一点。
```

The UI should show a pending state while search is running. A plain `思考中...` state is acceptable for v1, but a later version can distinguish `正在搜索...`.

## Automatic Web Search Rules

Deterministic v1 triggers:

- Selected text is short and looks like a name, and the question asks `是谁` or `介绍`.
- Question contains `现在`, `最新`, `官网`, `主页`, `背景`, `是谁`, `哪家公司`, `哪个机构`.
- Question asks about a proper noun not explained in the selected block.

Deterministic v1 skips:

- Question asks to translate, summarize, explain, or rewrite the selected passage.
- Question asks about a formula or method already present in the selected block.
- User explicitly says not to search.

Ambiguous cases go to the router prompt.

## Error Handling

- If router JSON parsing fails, fall back to deterministic rules.
- If search fails, continue with paper and history evidence.
- If search times out, continue and say external search was unavailable.
- If model composition fails, return the existing generic chat failure behavior.
- If no API key is configured, preserve the current error path.

Search failure should not block the user from getting a paper-context answer.

## Security And Privacy

- Only send the minimum necessary query to web search.
- Do not send full paper text to search providers.
- Prefer search queries based on selected text, paper title, and concise question terms.
- Keep search results as evidence, not as executable content.
- Escape source titles and URLs in the renderer.

## Testing

Manual tests:

1. Select `Susan Zhang` in an acknowledgments paragraph and ask `这是谁`.
   - Expected: answer says the paper only mentions her contribution, then uses web search if available.
2. Ask `介绍一下她`.
   - Expected: follow-up resolves `她` from chat history and searches if needed.
3. Select a technical paragraph and ask `这段是什么意思`.
   - Expected: no web search; answer is based on the selected paragraph.
4. Ask `CLIP 现在有哪些后续模型`.
   - Expected: web search triggers because the question asks for current external context.
5. Disable or fail web search.
   - Expected: answer still explains paper evidence and says external search was unavailable or found no reliable result.

Unit-level tests:

- Search trigger rules for person/background/current-info questions.
- Search skip rules for translation/explanation questions.
- Router JSON parse fallback.
- Prompt assembly includes soul and relevant policies.
- Chat history window excludes pending/error messages.

## Implementation Phases

### Phase 1: Harness Files And Prompt Assembly

- Add `llm/soul.md`.
- Add policy files.
- Add route and compose prompt templates.
- Add `llm-harness.ts` to load and assemble prompts.
- No behavior change yet.

### Phase 2: Dialogue Manager Without Search

- Add `dialogue-manager.ts`.
- Pass recent chat history into the dialogue input.
- Compose answers through the harness.
- Preserve current UI behavior.

### Phase 3: Automatic Web Search

- Add `web-search-service.ts` interface and provider implementation.
- Add deterministic trigger rules.
- Add router fallback for ambiguous cases.
- Include web evidence in final composition.

### Phase 4: Evidence Metadata In UI

- Extend `ChatMessage` to optionally store evidence metadata.
- Show source chips or source links for web-backed answers.
- Add a clearer pending state when search is running.

## V1 Decisions

- Web search should be implemented behind a `WebSearchService` interface.
- The first provider should be a simple HTTP search provider configured by environment variables. Use `WEB_SEARCH_PROVIDER=brave` and `BRAVE_SEARCH_API_KEY` as the default target unless the local runtime already has another approved provider.
- If no search key is configured, the feature should degrade gracefully and answer from paper context plus chat history.
- Source metadata should be returned in `DialogueAnswer` immediately, but storing it in `chats.json` can wait until the UI displays source chips.
- The router can use the same model as final composition in v1. A cheaper router model can be introduced later if latency or cost becomes a problem.
- A per-question `不要联网` text override should be supported by policy and deterministic rules. A dedicated UI toggle is not required in v1.

## Acceptance Criteria

- The chat feature uses `soul.md` and policy files for prompt assembly.
- Follow-up questions can use recent thread history.
- Person/background/current-info questions automatically trigger web search.
- The final answer distinguishes paper evidence from external evidence.
- If the paper lacks evidence, the assistant does not pretend the answer is in the paper.
- If web search fails, the assistant still gives a bounded paper-context answer.
- Existing paper-only explanation questions still work without web search.
