# Extension Guide

## Add A Tool

Create a TypeScript module in the configured tools directory, usually `tools/<tool-id>.ts`. Export a `RuntimeTool` as `default`, `tool`, or `tools`:

```ts
const readTool: RuntimeTool<{ path: string }, { text: string }> = {
  name: 'file.read',
  description: 'Read a file',
  inputSchema: { type: 'object' },
  timeoutMs: 5000,
  concurrencySafe: true,
  validateInput(input) {
    if (!input || typeof input !== 'object' || typeof (input as { path?: unknown }).path !== 'string') {
      return { ok: false, message: 'path is required' };
    }
    return { ok: true, value: input as { path: string } };
  },
  checkPermissions: async () => ({ decision: 'allow' }),
  execute: async (input) => ({ ok: true, output: { text: input.path } }),
  mapResultToModel: createDefaultToolResultMapper(),
};

export default readTool;
```

The CLI loads local tool modules automatically:

```ts
const factory = new ConsoleRuntimeFactory();
```

Agents choose which registered tools they can use through `agents/<agent-id>.md`:

```md
---
tools:
  allow:
    - file.read
  deny: []
---
```

## Add A Store

Implement `PersistenceStore` when adding a database, queue, or audit backend. Keep the method names stable so runtime code can stay closed for modification.

```ts
class PostgresRuntimeStore implements PersistenceStore {
  appendEvent(event) {}
  appendMessage(sessionId, message) {}
  saveToolCall(runId, record) {}
  saveApproval(sessionId, approval) {}
  saveRunSnapshot(snapshot) {}
  saveTerminalResult(result) {}
  loadSession(sessionId) {}
  loadRunSnapshot(runId) {}
}
```

## Add Runtime Behavior

Prefer injecting a `RuntimeExecutionHandler` instead of modifying `DefaultRuntimeEngine`:

```ts
const engine = new DefaultRuntimeEngine({
  store,
  execute: async (context, input) => {
    return createTerminalResult({
      status: 'success',
      runId: context.runId,
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      message: 'done',
    });
  },
});
```

This keeps the lifecycle boundary stable while letting applications customize execution.
