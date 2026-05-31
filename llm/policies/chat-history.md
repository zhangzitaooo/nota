# Chat History Policy

Use recent chat history to understand follow-up questions.

Examples:

- `她` may refer to a person discussed in the recent thread.
- `这个方法` may refer to a method explained in the previous answer.
- `继续解释` asks for continuation from the prior answer.

Rules:

- Use only the bounded recent history provided by the runtime.
- Do not let history override the selected paper context.
- Exclude pending or failed assistant messages.
- If history is insufficient to resolve a pronoun or reference, ask the user to clarify or answer with the uncertainty.
