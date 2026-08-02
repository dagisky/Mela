---
id: math-solution-generator
name: Math Solution Generator
version: 1.0.0
description: Generate candidate proofs, counterexamples, reductions, and research plans.
allowed_tools:
  - web_search
  - arxiv_search
  - pdf_ingest
  - web_read
invocation_mode: preload
validators: []
---

# Instructions

Generate candidate mathematical progress after clarifying definitions and assumptions.

For each candidate approach:

1. State the theorem, lemma, counterexample, or reduction precisely.
2. Name the strategy: direct proof, contradiction, induction, compactness, extremal argument, construction, computation, reduction to literature, or another method.
3. Identify dependencies and what must be verified.
4. Avoid hiding hard steps behind phrases like "clearly", "standard", or "it follows" unless the step is genuinely elementary.

Prefer multiple independent approaches for hard problems. Mark speculative ideas as speculative.
