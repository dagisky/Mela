# Mela Agentic Runtime Architecture

## Canonical Entry Points

New code should start from these modules:

```text
src/runtime/DefaultRuntimeEngine.ts
src/runtime/RunContext.ts
src/runtime/TerminalResult.ts
src/runtime/RuntimeEvents.ts
src/runtime/ConversationEngine.ts
src/tools/RuntimeTool.ts
src/tools/RuntimeToolRegistry.ts
src/tools/ToolExecutor.ts
src/persistence/PersistenceStore.ts
```

## Runtime Flow

```text
RuntimeEngine
  -> create RunContext
  -> persist session/run events
  -> invoke execution handler
  -> persist TerminalResult
```

Agent execution composes the lower-level primitives:

```text
ConversationEngine
  -> create RunContext
  -> enforce context budget
  -> call model
  -> execute tool calls through ToolExecutor
  -> append model-visible tool results
  -> validate terminal output
  -> persist TerminalResult
```

Tool execution follows one path:

```text
ToolExecutor
  -> resolve tool
  -> validate input
  -> check policy
  -> check tool permissions
  -> request approval when required
  -> schedule by concurrency safety
  -> execute with timeout/cancellation
  -> budget output
  -> map result to model-visible output
  -> persist audit record
```

## Extension Rules

- Add new CLI/runtime tools as external TypeScript modules in the configured tools directory, such as `tools/file-read.ts`.
- Export a `RuntimeTool` as `default`, `tool`, or `tools`. The runtime loads these modules into `RuntimeToolRegistry` through `LocalToolModuleProvider`.
- Keep agent and skill definitions declarative. They should reference tool names through allow/deny policy, while the root tools directory owns the actual implementation.
- Add new persistence backends by implementing `PersistenceStore`.
- Add new policy behavior by extending `PolicyEngine` or injecting a compatible policy object into `ToolExecutor`.
- Add new runtime orchestration through `RuntimeExecutionHandler`; keep `RuntimeEngine` as the outer lifecycle boundary.
- Use `ConversationEngine` when the runtime should own the full model/tool turn loop.
- Use `InteractiveApprovalManager` when callers need a real pause/resume approval lifecycle instead of automatic decisions.
- Keep expected failures as terminal results or model-visible tool results. Reserve thrown exceptions for programmer errors.

## Design Constraints

- Every run ends in a `TerminalResult`.
- Every model-requested tool call returns exactly one model-visible tool result.
- Runtime state needed for debugging should pass through `PersistenceStore`.
- Compatibility modules may delegate to canonical modules, but canonical modules must not depend on compatibility modules.
- Core runtime packages should not import application services directly.
- Agent and skill definitions plus project-specific tool modules should remain external to the core runtime so the same runtime can power different agents without core code changes.
