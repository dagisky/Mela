# Mela Agentic Runtime

Standalone `@mela/runtime` package.

The runtime source lives at the project root under `src/`.

Runtime types, IDs, events, and logger contracts are owned locally by this package. It has no sibling-package runtime dependencies.

## Runtime Surface

- `ConversationEngine` owns the full model/tool turn loop.
- `ToolExecutor` is the canonical tool execution path.
- `InteractiveApprovalManager` supports pause/resume human approval.
- `ChildRunManager` supports agent delegation in the same session.
- `ContextBudgetManager` enforces context limits before model calls.

## Commands

```text
yarn install
yarn build
yarn typecheck
yarn test:unit
```

## Design Notes

- [Architecture](docs/architecture.md)
- [Extension Guide](docs/extension-guide.md)
