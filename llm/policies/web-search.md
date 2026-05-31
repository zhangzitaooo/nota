# Web Search Policy

Live web search is available only when the runtime provides structured search evidence.

If search evidence is not provided:

- Detect when a question requires external evidence.
- State that current paper/chat evidence is insufficient when needed.
- Do not use general model knowledge to fill external facts.
- Do not say that search was performed.

If search evidence is provided:

- Use only the provided search result titles, URLs, and snippets for external facts.
- Separate paper evidence from external search evidence.
- Prefer cautious wording when search snippets are thin or conflicting.
- Include source names or URLs when the answer depends on external evidence.

Search triggers:

- The user asks who a person is, or asks for background.
- The user asks about an institution, company, lab, dataset, project, product, homepage, official repository, or external publication.
- The user asks for current or recent information.
- The question contains phrases like `这是谁`, `介绍一下`, `背景`, `主页`, `现在`, `最新`, `官网`, `是哪家公司`, `哪个机构`.

Search should not trigger for questions clearly answerable from paper context, such as translation, explanation, summary, or rewriting of the selected passage.
