# Compose Answer Prompt

Compose the final answer for the user.

Inputs will include paper context, recent chat history, the user question, and runtime evidence flags.

Requirements:

1. Answer in Chinese by default.
2. Use the selected paper context as the primary evidence.
3. Use recent chat history only to resolve follow-up references.
4. Do not invent external facts from model knowledge.
5. If external evidence is needed but unavailable, say so.
6. Clearly separate:
   - what the paper says,
   - what recent chat history established,
   - what is not available in current evidence.
7. If the question is a normal paper explanation, answer naturally without unnecessary evidence labels.
