# LLM Harness Design

Date: 2026-05-30
Project: paper-reading-workbench

## Summary

Add a lightweight LLM harness for the AI chat feature. The harness should make the assistant more evidence-aware: it should answer from the selected paper context when possible, use recent chat history for follow-up questions, and clearly state uncertainty instead of guessing.

This is a dialogue-management feature, not a full agent framework. The first version should be small, inspectable, and easy to tune through versioned Markdown policy files.

The implementation target for the next development pass is **V1: harness without live web search**. Web search remains part of the design, but moves to V1.5 after the core paper-grounded dialogue behavior is stable.

## Goals

- Move chat behavior out of one hard-coded prompt and into a small LLM harness.
- Add a stable assistant identity through `soul.md`.
- Add explicit policies for grounding, chat history, uncertainty, answer style, and future web search.
- Preserve the user's selected paper context as the primary evidence source.
- Use recent thread history for follow-up questions.
- Distinguish clearly between:
  - what the paper says,
  - what prior conversation established,
  - what external search found when search is available in a later phase,
  - what remains uncertain.
- Prevent the model from inventing external identities, affiliations, or background facts when the paper does not provide them.
- Keep the implementation understandable inside the existing Electron service structure.

## Non-Goals

- Do not build a general-purpose autonomous agent.
- Do not add multi-step planning loops in v1.
- Do not let the model freely decide to call arbitrary tools.
- Do not require a new backend server.
- Do not redesign the chat UI in V1.
- Do not solve PDF parsing or translation quality issues in this feature.
- Do not implement live web search in V1.
- Do not add source chips, citation UI, or search-specific pending states in V1.

## Current Code Context

The current chat flow is simple:

- `src/App.tsx` chooses chat scope from `selectedBlockId`, `activeChatId`, or `__document__`.
- A `ChatThread` is reused by `blockId + selectedText`.
- `ChatThread.messages` are saved locally in `chats.json`.
- `window.electronAPI.chatAsk(...)` sends only the current question plus paper context.
- `electron/services/deepseek-client.ts` builds a fixed paper-assistant prompt and calls `deepseek-v4-pro`.
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
  -> optionally collect web search evidence in V1.5+
  -> compose answer with source boundaries
```

## Proposed File Structure

```text
llm/
  soul.md
  policies/
    grounding.md
    chat-history.md
    uncertainty.md
    answer-style.md
    web-search.md
  prompts/
    compose-answer.md
    route-question.md

electron/services/
  llm-harness.ts
  dialogue-manager.ts
  web-search-service.ts
```

The Markdown files define product behavior. The TypeScript services enforce execution boundaries.

For V1, `web-search.md`, `route-question.md`, and `web-search-service.ts` may be created as policy/interface placeholders, but they should not change runtime behavior unless a later phase enables search.

## Policy Files

### `llm/soul.md`

Defines the assistant's durable identity:

- It is a paper reading assistant, not a generic chatbot.
- It helps the user understand academic papers precisely.
- It prefers grounded answers over fluent speculation.
- It can use external sources when the paper does not contain enough information.
- It must keep paper evidence and web evidence separate.
- In V1, if external evidence is unavailable, it must say so rather than relying on general model knowledge.

Example policy language:

```md
You are the AI assistant inside a paper reading workbench.
Your job is to help the user understand the paper they are reading.
When the paper does not contain enough information, say so and use approved external evidence if available.
Never present an external fact as if it came from the paper.
If approved external evidence is unavailable, do not guess.
```

### `llm/policies/grounding.md`

Defines evidence priority:

1. User-selected text.
2. Selected block Chinese translation.
3. Selected block English source.
4. Section path and paper title.
5. Recent chat history in the same thread.
6. Web search results when search is enabled in a later phase.

Rules:

- Use paper evidence first for interpretation questions.
- Do not invent details missing from the paper.
- When the selected block is sparse, say the paper only provides limited evidence.
- If a claim comes from web search, label it as external.
- In V1, do not use model background knowledge as if it were evidence. If the paper and chat history do not support the answer, say the information is not available in the current evidence.

### `llm/policies/web-search.md`

Defines future automatic search triggers. This file is included in the design now so V1 answers can already describe search as unavailable when needed, but V1 does not perform live web requests.

In V1:

- Questions that require external facts should be classified as outside the available paper evidence.
- The assistant should state that external search is not enabled or not available.
- The assistant should not use latent model knowledge to fill the gap.

In V1.5+, search should trigger when the question asks for external facts.

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

Reserved for V1.5+ when rules are not enough. V1 should not add a router call unless implementation complexity is still small after the composer harness is in place.

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

The model router is advisory. Code-level rules can force web search for high-confidence trigger patterns once search is enabled.

### `llm/prompts/compose-answer.md`

Used to produce the final answer after evidence collection.

The composer receives:

- `soul.md`,
- relevant policies,
- paper context,
- recent chat history,
- web search evidence if any in later phases,
- route decision if routing is enabled,
- user question.

It must produce the final user-facing answer and obey evidence boundaries.

## Runtime Architecture

### `llm-harness.ts`

Responsibilities:

- Load `llm/soul.md`.
- Load policy files.
- Load prompt templates.
- Build system and user messages for composer calls.
- Build router messages in a later search phase if needed.
- Keep prompt assembly in one place.

Suggested API:

```ts
export class LlmHarness {
  buildComposeMessages(input: ComposeInput): ChatMessage[];
  buildRouteMessages?(input: RouteInput): ChatMessage[];
}
```

### `dialogue-manager.ts`

Responsibilities:

- Accept the chat request from the IPC handler.
- Attach recent chat history.
- Apply deterministic evidence-need rules.
- Mark external-fact questions as unsupported by current evidence when search is unavailable.
- Ask the router model only for ambiguous cases in V1.5+.
- Call `web-search-service` when search is enabled in V1.5+.
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

This is a V1.5+ service. For V1, the dialogue manager can depend on a search interface or a disabled stub, but no live provider is required.

The first live implementation should be designed separately as a product-owned HTTP search provider. The dialogue manager should depend on an interface rather than provider-specific code.

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

For V1, the renderer can still store `content` as the assistant message. The evidence metadata can stay in the main-process return value or be discarded by the renderer until source chips are designed.

The V1 renderer contract may remain `Promise<string>` if that keeps the change small. If a structured `DialogueAnswer` is returned internally, `chat-ask` can unwrap `content` before returning to the current UI.

## User Experience

For paper-only answers:

```text
这句话的意思是...
```

For V1.5+ mixed paper plus web answers:

```text
论文里能确认的是：Susan Zhang 在致谢中被提到，作者感谢她在图像条件语言模型研究上的贡献。

论文没有说明的是：她的完整身份、职位或个人背景。

外部搜索显示：...
```

For V1.5+ failed search:

```text
论文里没有提供足够信息确认她是谁。我也没有找到可靠的外部来源来补充这一点。
```

For V1 without search:

```text
论文里能确认的是：Susan Zhang 在致谢中被提到，作者感谢她在图像条件语言模型研究上的贡献。

论文没有说明的是：她的完整身份、职位或个人背景。当前没有可用的外部搜索证据，因此我不能进一步确认。
```

The existing plain `思考中...` pending state is sufficient for V1. A later version can distinguish `正在搜索...` once live search is enabled.

## External Evidence Rules

V1 should not execute web search. It should still detect when a question requires external evidence, so the assistant can avoid guessing.

Deterministic V1 external-evidence triggers:

- Selected text is short and looks like a name, and the question asks `是谁` or `介绍`.
- Question contains `现在`, `最新`, `官网`, `主页`, `背景`, `是谁`, `哪家公司`, `哪个机构`.
- Question asks about a proper noun not explained in the selected block.

Deterministic V1 paper-only skips:

- Question asks to translate, summarize, explain, or rewrite the selected passage.
- Question asks about a formula or method already present in the selected block.
- User explicitly says not to search.

V1 behavior:

- If external evidence is needed, answer from paper context and explicitly state what is not available.
- Do not use general model knowledge to fill in identity, affiliation, current status, or external background.
- Do not say web search was performed.

V1.5+ behavior:

- The same triggers can call `web-search-service`.
- Ambiguous cases can go to the router prompt.
- Search-backed claims must be labeled as external.

## Error Handling

- If router JSON parsing fails in V1.5+, fall back to deterministic rules.
- If search is disabled in V1, continue with paper and history evidence and say external evidence is unavailable when needed.
- If search fails or times out in V1.5+, continue and say external search was unavailable.
- If model composition fails, return the existing generic chat failure behavior.
- If no API key is configured, preserve the current error path.

Search failure should not block the user from getting a paper-context answer.

## Security And Privacy

V1 should not send any data to a search provider because live search is disabled.

V1.5+ search should follow these rules:

- Only send the minimum necessary query to web search.
- Do not send full paper text to search providers.
- Prefer search queries based on selected text, paper title, and concise question terms.
- Keep search results as evidence, not as executable content.
- Escape source titles and URLs in the renderer.

## Testing

Manual tests:

1. Select `Susan Zhang` in an acknowledgments paragraph and ask `这是谁`.
   - Expected V1: answer says the paper only mentions her contribution and does not infer her full identity.
2. Ask `介绍一下她`.
   - Expected V1: follow-up resolves `她` from chat history and preserves the same evidence boundary.
3. Select a technical paragraph and ask `这段是什么意思`.
   - Expected: no web search; answer is based on the selected paragraph.
4. Ask `CLIP 现在有哪些后续模型`.
   - Expected V1: answer says this asks for current external context and that current evidence is insufficient without external search.
5. Ask a normal paper explanation question after several prior turns.
   - Expected V1: answer can use the recent thread history to resolve references such as `这个方法` or `继续解释`.

Unit-level tests:

- External-evidence trigger rules for person/background/current-info questions.
- Paper-only skip rules for translation/explanation questions.
- Prompt assembly includes soul and relevant policies.
- Chat history window excludes pending/error messages.
- V1 answers do not claim unsupported identities or affiliations.
- V1.5+ router JSON parse fallback, when routing is enabled.

## Implementation Phases

### Phase 1: V1 Harness Files And Prompt Assembly

- Add `llm/soul.md`.
- Add policy files.
- Add `compose-answer.md`.
- Add `route-question.md` only as a placeholder if useful for future search work.
- Add `llm-harness.ts` to load and assemble prompts.
- No behavior change yet.

### Phase 2: V1 Dialogue Manager Without Search

- Add `dialogue-manager.ts`.
- Pass recent chat history into the dialogue input.
- Add deterministic external-evidence detection.
- Remove the current prompt behavior that permits broad "reasonable inference" from paper title plus model knowledge.
- Compose answers through the harness.
- Preserve current UI behavior.

This is the recommended immediate implementation target.

### Phase 3: V1.5 Automatic Web Search

- Add `web-search-service.ts` interface and provider implementation.
- Add deterministic trigger rules.
- Add router fallback for ambiguous cases.
- Include web evidence in final composition.

### Phase 4: V2 Evidence Metadata In UI

- Extend `ChatMessage` to optionally store evidence metadata.
- Show source chips or source links for web-backed answers.
- Add a clearer pending state when search is running.

## V1 Decisions

- V1 does not perform live web search.
- V1 should still detect external-evidence questions and refuse to guess beyond available evidence.
- V1 should use recent active-thread history: last 6 user/assistant messages, excluding pending/error assistant messages.
- V1 can keep the renderer response as a string to avoid UI churn.
- V1 should create policy files as editable Markdown and load them at runtime from Electron.
- V1 should keep search policy text in the repository, but treat it as disabled runtime behavior.
- V1.5 should implement search behind an interface.
- The first live search provider should be designed as a product-owned HTTP search provider. Until that design exists, runtime search should remain disabled rather than depending on a local agent runtime or a bundled third-party API key.
- Source metadata can be returned in `DialogueAnswer` once V1.5 search is implemented, but storing it in `chats.json` can wait until the UI displays source chips.
- A per-question `不要联网` text override should be supported by policy and deterministic rules once search is enabled. A dedicated UI toggle is not required.

## Acceptance Criteria

- The chat feature uses `soul.md` and policy files for prompt assembly.
- Follow-up questions can use recent thread history.
- Person/background/current-info questions do not trigger unsupported identity or background guesses in V1.
- The final answer distinguishes paper evidence, chat-history evidence, unavailable external evidence, and uncertainty.
- If the paper lacks evidence, the assistant does not pretend the answer is in the paper.
- If external evidence is unavailable, the assistant still gives a bounded paper-context answer.
- Existing paper-only explanation questions still work without web search.
