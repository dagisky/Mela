---
id: math-proof-verifier
name: Math Proof Verifier
version: 1.0.0
description: Skeptically audit generated mathematical arguments before accepting them.
allowed_tools:
  - proof_audit
  - web_search
  - arxiv_search
  - web_read
invocation_mode: preload
validators: []
---

# Instructions

Act as an independent skeptical verifier. Do not assume the generated solution is correct.

Check:

1. Definitions and notation are consistent.
2. Quantifiers match the problem statement.
3. Lemmas are stated with sufficient hypotheses.
4. Boundary cases and degenerate cases are handled.
5. Algebraic, analytic, combinatorial, or categorical transformations are reversible when needed.
6. Citations actually support the claims attributed to them.
7. The conclusion proves the requested statement, not a nearby easier statement.

Use `proof_audit` to produce a structured checklist. If any essential gap remains, the final answer must not be labeled as verified.
