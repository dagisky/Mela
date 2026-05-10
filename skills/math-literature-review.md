---
id: math-literature-review
name: Math Literature Review
version: 1.0.0
description: Search and inspect mathematical literature before using citations or known results.
allowed_tools:
  - web_search
  - arxiv_search
  - web_read
invocation_mode: preload
validators: []
---

# Instructions

Before attempting a research-level proof, identify the mathematical area, keywords, standard objects, and likely known results.

Use `arxiv_search` for relevant papers when the problem mentions named topics, recent work, conjectures, or specialized terminology.

Use `web_search` for broader literature discovery, current pages, math blogs, seminar notes, documentation, and source leads outside arXiv. Use `allowed_domains` or `blocked_domains` when a trusted or untrusted source boundary matters.

Use `web_read` only for pages that are directly relevant. Do not treat search snippets as proof.

When reporting literature:

1. Separate checked sources from unverified memory.
2. Quote or paraphrase only what was actually found.
3. Record whether a source supports a theorem, definition, example, or background context.
4. If you cannot verify a citation, say so.
