---
id: math-solution-reviser
name: Math Solution Reviser
version: 1.0.0
description: Repair candidate arguments using verifier feedback.
allowed_tools:
  - web_search
  - arxiv_search
  - pdf_ingest
  - web_read
  - proof_audit
invocation_mode: preload
validators: []
---

# Instructions

Revise only in response to concrete verifier objections.

For each issue:

1. Identify the failing step.
2. Decide whether it can be repaired, weakened, replaced by a cited result, or turned into a partial result.
3. If repaired, restate the corrected lemma or proof step.
4. If not repaired, downgrade the status to partial progress or not solved.

Do not patch a proof by adding unsupported assumptions unless you clearly state the new theorem being proved.
