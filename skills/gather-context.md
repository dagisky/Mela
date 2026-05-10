---
id: gather-context
name: Gather Context
version: 1.0.0
description: Gather focused context before answering.
allowed_tools:
  - arxiv_search
invocation_mode: preload
validators: []
---

# Instructions

Use the current conversation and available runtime context to identify what matters for the user's request.

# Examples

Return short notes and mention uncertainty when context is incomplete.
