# Tool Calling Harness Spec

Date: 2026-05-31
Project: paper-reading-workbench
Related spec: `SPEC/llm-harness-design_SPEC.md`

## Summary

Replace the direct web-search strategy with a small tool-calling harness.

The current V1.5 attempt routes external questions in app code and calls a concrete search provider directly. That is useful as a prototype, but it hard-codes too much behavior in `DialogueManager`. The next design should let the model decide when a tool is needed, while the app keeps control over which tools exist, how they execute, and how evidence is returned.

In this design, DeepSeek receives a `web_search` tool definition. When the model decides search is needed, it returns a tool call. The harness executes the tool, appends the tool result to the message list, and asks DeepSeek to produce the final grounded answer.

DeepSeek tool calling still requires application-side execution: the model can request a function call, but the app must provide and run the actual function. This matches the official DeepSeek Tool Calls contract.

## Goals

- Remove the hard-coded Brave Search decision path from `DialogueManager`.
- Use DeepSeek tool calling as the primary way to decide whether external search is needed.
- Keep paper context, document context, recent chat history, and source boundaries from the current LLM harness.
- Introduce a minimal `ToolRegistry` that can host `web_search` now and other tools later.
- Make the search provider replaceable: product-owned HTTP service, MCP tool, or a disabled stub.
- Keep the first implementation light: one model tool loop, one search tool, no new backend server.
- Preserve safety: external facts must come from paper context, chat history, or tool results, not model memory.

## Non-Goals

- Do not build a full autonomous agent framework.
- Do not add arbitrary file-system, browser, or shell tools.
- Do not let the model call tools that are not explicitly registered.
- Do not make every question search the web.
- Do not redesign the chat UI in this pass.
- Do not require users to configure Brave Search specifically.
- Do not depend on DeepSeek having built-in web browsing. The app still owns tool execution.

## Current Problem

The existing implementation has two different strategies mixed together:

1. `DialogueManager` detects external-evidence questions with deterministic rules.
2. If external evidence is needed, it calls a concrete search service path.

This creates three issues:

- The model is not actually using a skill; the app is deciding search before the model reasons about the question.
- A concrete provider such as Brave leaks into the product strategy.
- If we later want MCP tools or other providers, we need to reshape the orchestration anyway.

The desired behavior is a model-led tool loop:

```text
User asks question
  -> model sees paper context, chat history, and available tools
  -> model decides whether to call web_search
  -> harness executes web_search
  -> model receives tool result
  -> model answers with paper/tool evidence boundaries
```

## Design Principle

The model may decide tool intent, but the harness controls tool authority.

That means:

- The model can request `web_search`.
- The harness validates the requested tool name and arguments.
- The harness executes only approved local tool implementations.
- The harness returns structured tool evidence.
- The model writes the final answer only after evidence is collected.
- The harness can still enforce safety fallbacks if the model skips a required tool.

## Proposed Architecture

```text
src/App.tsx
  -> window.electronAPI.chatAsk(DialogueInput)

electron/main.ts
  -> DialogueManager.answer(input)

DialogueManager
  -> build paper/document/history context
  -> call ToolCallingHarness.run(input)

ToolCallingHarness
  -> LlmHarness.buildToolMessages(input)
  -> DeepSeekClient.completeWithTools(messages, tools)
  -> if tool_calls:
       ToolRegistry.execute(tool_call)
       append tool result messages
       DeepSeekClient.complete(messages_with_tool_results)
  -> return DialogueAnswer

ToolRegistry
  -> web_search tool

WebSearchTool
  -> provider implementation
     - BuiltInHttpSearchProvider
     - McpWebSearchProvider
     - DisabledWebSearchProvider
```

## File Structure

```text
electron/services/
  dialogue-manager.ts
  llm-harness.ts
  deepseek-client.ts
  tool-calling-harness.ts
  tools/
    tool-registry.ts
    tool-types.ts
    web-search-tool.ts
    providers/
      built-in-http-search-provider.ts
      mcp-web-search-provider.ts
      disabled-web-search-provider.ts

llm/
  policies/
    grounding.md
    chat-history.md
    uncertainty.md
    answer-style.md
    tool-use.md
  prompts/
    compose-answer.md
```

The provider list is an interface boundary. The first implementation can ship with `DisabledWebSearchProvider` and one real provider only if credentials/integration are available.

## Data Contracts

### Dialogue Input

```ts
interface DialogueInput {
  paperTitle: string;
  sectionPath: string[];
  selectedText: string;
  zhBlock: string;
  enBlock: string;
  documentContext?: string;
  question: string;
  chatHistory?: DialogueHistoryMessage[];
}
```

### Dialogue Answer

```ts
interface DialogueAnswer {
  content: string;
  evidence: {
    usedPaperContext: boolean;
    usedDocumentContext: boolean;
    usedChatHistory: boolean;
    usedTools: string[];
    sources: SourceEvidence[];
  };
  uncertainty: {
    paperHadAnswer: boolean;
    externalEvidenceFound: boolean;
    notes: string[];
  };
}
```

The renderer can keep receiving `content` only in the first pass. The structured payload should remain available in the main process so it can later power source chips or debugging.

### Tool Definition

```ts
interface HarnessTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

### Tool Execution Context

```ts
interface ToolExecutionContext {
  paperTitle: string;
  selectedText: string;
  question: string;
}
```

### Tool Execution Result

```ts
interface ToolExecutionResult {
  toolName: string;
  ok: boolean;
  content: string;
  evidence?: SourceEvidence[];
  error?: string;
}
```

### Source Evidence

```ts
interface SourceEvidence {
  title: string;
  url: string;
  snippet?: string;
  sourceType: 'official' | 'paper' | 'profile' | 'news' | 'other';
}
```

## `web_search` Tool

### Tool Name

`web_search`

### Description

Search the web for external facts that are not contained in the current paper context. Use this for current status, latest work, official websites, author background, organizations, datasets, repositories, or other proper nouns whose identity cannot be confirmed from the paper.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "A concise search query. Include the selected term and paper title when useful."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

### Execution Rules

- The tool receives a concise query only.
- Do not send full paper text to the search provider.
- Prefer queries built from selected text, paper title, and the user's question.
- Return a bounded number of results, recommended 3-5.
- Normalize provider results into `SourceEvidence`.
- If the provider is unavailable, return `ok: false` with a clear error.

## Provider Strategy

The product should not depend on Brave as a strategy.

`web_search` should be provider-agnostic:

```ts
interface WebSearchProvider {
  isEnabled(): boolean | Promise<boolean>;
  search(query: string): Promise<SourceEvidence[]>;
}
```

Provider priority:

1. Built-in HTTP search provider, when the product search service is configured.
2. MCP web-search tool, if a future advanced-user integration is explicitly configured.
3. Disabled provider.

Brave can remain as one optional HTTP provider, but it should not appear in product strategy, policy wording, or `DialogueManager` routing.

Current implementation status:

- Phase 1 and Phase 2 keep a disabled `web_search` stub only.
- Phase 3 has not started.
- The app must not depend on any local agent runtime for ordinary users.
- A future real provider should be implemented as a product-owned HTTP provider or service.

## DeepSeek Tool Calling Loop

The harness should run a bounded loop:

```text
1. Build messages:
   - system policies
   - paper/document context
   - recent chat history
   - user question

2. Call DeepSeek with tools = [web_search].

3. If response has no tool calls:
   - accept the answer only if it does not make unsupported external claims.
   - otherwise apply fallback behavior.

4. If response has tool calls:
   - validate tool name and JSON arguments.
   - execute approved tool.
   - append assistant tool_call message and tool result message.
   - call DeepSeek again without allowing endless loops.

5. Return final content and structured evidence metadata.
```

Recommended first-pass limit:

- Maximum tool rounds: `1`.
- Maximum tool calls per round: `1`.
- Tool timeout: `8s`.
- Search results per call: `5`.

This keeps the feature light and prevents accidental agent loops.

## Safety Fallbacks

The model decides whether to call `web_search`, but the harness should still protect high-risk cases.

High-risk external triggers:

- `这是谁`
- `介绍一下`
- `背景`
- `官网`
- `主页`
- `现在`
- `最新`
- `哪个机构`
- `哪家公司`
- `current`
- `latest`
- `official`
- `homepage`

If a high-risk question has no tool call and the draft answer contains unsupported external claims, the harness should not return that answer directly.

V1 fallback options:

1. Ask a second constrained model call:

```text
This question requires external evidence. You did not call web_search.
Answer only from paper/context, or say the search tool is unavailable.
```

2. If the search tool is configured and the trigger is strong, force one `web_search` call from code.

Recommended first implementation: use option 1. It keeps model-led tool use intact and is simpler than forced search orchestration.

## Prompt Policy Changes

Add `llm/policies/tool-use.md`:

```md
# Tool Use Policy

You may call approved tools when the paper and chat history do not contain enough evidence.

Available tools:

- web_search: use for external identity, background, official websites, latest/current status, repositories, later work, or facts outside the paper.

Rules:

- Do not use model memory for external facts when a tool is needed.
- Do not call tools for normal paper explanation, translation, summary, or close reading.
- If a tool is unavailable or returns no useful evidence, say what cannot be confirmed.
- Final answers must separate paper evidence from tool evidence.
```

Update existing policies:

- `web-search.md` becomes a policy for when `web_search` is appropriate, not a provider policy.
- `grounding.md` should list tool evidence as an evidence source.
- `uncertainty.md` should describe failed or unavailable tool evidence.
- `compose-answer.md` should require source boundaries when tool evidence is present.

## Migration From Current Code

Remove or demote the direct-search prototype:

- Remove provider-specific routing from `DialogueManager`.
- Stop calling `BraveWebSearchService` directly from `DialogueManager`.
- Keep `web-search-service.ts` only if it is refactored into a provider under `tools/providers/`.
- Remove product-facing references that imply Brave is required.
- Keep document-level context generation in `src/App.tsx`; it is useful regardless of tool calling.
- Keep recent chat history passing.

After migration, `DialogueManager` should coordinate context and call `ToolCallingHarness`, not decide provider-specific search behavior.

## Error Handling

- If tool argument JSON is invalid, return a tool error to the model and ask it to answer within available evidence.
- If tool name is unknown, do not execute it.
- If the provider is disabled, return a tool result saying search is unavailable.
- If the provider times out, return a bounded error and ask the model to answer from paper context.
- If the final model call fails, keep the existing UI error message: `回答失败，请稍后重试。`

Search failure should not block paper-context answers.

## Privacy

- Never send full paper text to search providers.
- Tool query should be concise and purpose-built.
- Do not store raw search logs unless a debug mode is explicitly enabled.
- If source metadata is later stored in `chats.json`, store only title, URL, snippet, and source type.
- Escape source titles and URLs before rendering in UI.

## UI Impact

No required UI redesign for the first pass.

Current chat UI can continue showing:

- user message,
- pending assistant message,
- final answer.

Optional later UI:

- `正在搜索...` pending label when a tool call is active.
- Source chips under answers.
- Debug panel showing which tools were called.

## Acceptance Criteria

1. Paper explanation questions do not call `web_search`.
2. `这篇论文的核心贡献是什么？` uses document context when available.
3. `这是谁？` on a selected person name calls or attempts `web_search`.
4. If `web_search` is unavailable, the answer says external evidence is unavailable and does not invent identity.
5. If `web_search` returns evidence, the final answer separates paper evidence from external evidence.
6. Tool calls are limited to registered tools.
7. Unknown tool names and invalid arguments are rejected.
8. Normal chat history follow-ups still work.
9. The renderer can keep receiving a string answer in the first pass.
10. The app still builds with `tsc -p tsconfig.electron.json` and `npm run build`.

## Test Cases

### Paper Explanation

Question:

```text
这段是什么意思？
```

Expected:

- No tool call.
- Answer uses selected text/paragraph.
- No source boundary boilerplate unless needed.

### Whole Paper

Question:

```text
这篇论文的核心贡献是什么？
```

Expected:

- No web search required.
- Uses document context.
- Does not say there is no paper evidence if document context is present.

### Person Identity

Selected text:

```text
Susan Zhang
```

Question:

```text
这是谁？
```

Expected:

- Model calls `web_search`, or fallback prevents unsupported identity claims.
- If tool unavailable, answer only says what paper confirms.
- If tool available, answer includes source boundary.

### Current Context

Question:

```text
CLIP 现在有哪些后续模型？
```

Expected:

- Model calls `web_search`.
- Final answer does not rely on model memory.
- Sources are available in `DialogueAnswer.evidence.sources`.

### App Usage

Question:

```text
这个应用怎么导出 PDF？
```

Expected:

- No web search.
- Answer uses known product capability: reading page top-right `导出` button.

## Implementation Phases

### Phase 1: Harness Skeleton

- Add `tool-calling-harness.ts`.
- Add `tools/tool-types.ts`.
- Add `tools/tool-registry.ts`.
- Add disabled `web_search` tool.
- Add `llm/policies/tool-use.md`.
- Update prompt assembly to include tool-use policy.

### Phase 2: DeepSeek Tool Call Support

- Add `DeepSeekClient.completeWithTools`.
- Preserve raw assistant tool-call message for the follow-up call.
- Append tool result messages using the returned `tool_call_id`.
- Limit to one tool round in the first pass.

### Phase 3: Web Search Provider

- Design and connect a product-owned built-in HTTP search provider.
- Keep API keys outside the distributed Electron client.
- If no product search service is configured, keep using the disabled provider.
- Move any provider-specific code under optional provider modules only if still useful.

### Phase 4: Fallback And Metadata

- Add high-risk external question fallback.
- Return structured tool evidence internally.
- Keep renderer response as `content` for now.

### Phase 5: Optional UI

- Add `正在搜索...` pending state.
- Add source chips.
- Add dev-only debug logs.

## Open Decisions

1. Which provider should back `web_search` first in local Electron?
   - Recommendation: product-owned HTTP search provider; keep disabled provider until that service is chosen.

2. Should high-risk questions force search if the model does not call the tool?
   - Recommendation: not in the first pass. Use constrained fallback first.

3. Should source metadata be stored in `chats.json` immediately?
   - Recommendation: no. Return metadata internally first; persist only after source UI is designed.

## Recommended Next Step

Phase 1 and Phase 2 are the current baseline. Next, design Phase 3 as a product-owned search provider, without requiring any local agent runtime.
