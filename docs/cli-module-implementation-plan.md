# CLI Module Implementation Plan

This plan describes how to add a robust CLI module to `mela-agentic-runtime`, taking inspiration from:

- `minimal-agentic-runtime`: clean readline console, command bus, session object, renderer, dotenv loading, approval flow, simple `chat` and `console` scripts.
- `claude-code-rev`: mature command surface, fast startup paths, permission prompts, session controls, structured output modes, status/debug commands, cancellation, and production-grade operator workflows.

The goal is not to copy either project directly. The goal is to build a clean, dependency-light CLI that fits `mela-agentic-runtime` as a standalone runtime package and exceeds `claude-code-rev` as a reusable agentic-runtime CLI.

## North Star

The Mela CLI should be better than `claude-code-rev` in the areas where a standalone runtime should win:

- Cleaner architecture with hard boundaries between CLI shell, runtime assembly, and core runtime.
- Provider-portable model integration instead of product-specific provider assumptions.
- First-class scriptability through JSON, NDJSON, and stable exit codes.
- Better testability with no network, no API key, and no terminal UI required for normal tests.
- Safer default permissions with explicit policy modes and auditable approval records.
- Smaller dependency surface and faster cold-start path.
- Clear extension points for commands, renderers, providers, tools, policies, and session stores.
- Runtime-library quality exports, not only an application entrypoint.

Success is not measured by having more commands than `claude-code-rev`. Success is measured by having a more coherent, safer, easier-to-extend CLI runtime.

## Goals

- Provide a usable interactive console for running agents.
- Provide a one-shot chat command for scripts and smoke tests.
- Load local `.env` safely for CLI usage without forcing env loading into the runtime library.
- Support OpenAI and mock clients first, with room for Anthropic or custom providers.
- Expose runtime status, tools, sessions, approvals, cancellation, and debug information through commands.
- Keep the CLI modular, testable, and separate from core runtime logic.
- Preserve the package's dependency hygiene.
- Provide stable machine-readable output for automation.
- Make permission and approval decisions explainable, replayable, and auditable.
- Support fast-path startup for `--help`, `--version`, and simple validation commands.
- Make command/plugin extension possible without changing the core console loop.

## Non-Goals

- Do not turn the runtime package into a full terminal UI app on day one.
- Do not introduce React/Ink-style rendering until the basic CLI is stable.
- Do not make `.env` loading part of the library runtime.
- Do not require live OpenAI calls for normal unit tests.
- Do not add background daemons, remote control, plugin marketplaces, or MCP management in the first implementation.
- Do not couple the CLI to one model provider, one agent format, one persistence backend, or one renderer.
- Do not hide permission decisions behind UI-only state; every decision must be representable as data.

## Architecture Principles

The CLI must be split into three layers:

### 1. CLI Shell Layer

Owns process behavior only:

- argument parsing
- command dispatch
- readline loop
- renderer selection
- stdout/stderr behavior
- exit codes
- Ctrl+C handling
- JSON/NDJSON/text output modes

This layer must not know provider-specific API details.

### 2. Runtime Assembly Layer

Builds runtime dependencies:

- `.env` and config loading
- model client selection
- agent loading
- store creation
- tool registration
- policy engine creation
- approval manager creation
- observability/event wiring

This layer may know about OpenAI, mock clients, local files, and CLI-specific configuration.

### 3. Core Runtime Layer

Uses existing runtime primitives:

- `ConversationEngine`
- `RuntimeToolRegistry`
- `ToolExecutor`
- `PolicyEngine`
- `PersistenceStore`
- `EventBus`
- `OutputValidator`
- `AgentCircuitBreaker`

The core runtime must remain usable without the CLI.

This three-layer split is the main design advantage over `claude-code-rev`, where product CLI, app state, permissions, model config, and rendering are much more tightly coupled.

## Proposed Package Layout

Add a new `src/cli` package:

```text
src/cli/
  ChatCommand.ts
  ConsoleApp.ts
  ConsoleBanner.ts
  ConsoleCommand.ts
  ConsoleCommandBus.ts
  ConsoleCommandQueue.ts
  ConsoleCommandRegistry.ts
  ConsoleHistory.ts
  ConsoleInputParser.ts
  ConsoleMode.ts
  ConsoleRenderer.ts
  ConsoleRuntimeFactory.ts
  ConsoleSession.ts
  DotEnvLoader.ts
  CliArgs.ts
  CliConfig.ts
  CliEntrypoint.ts
  InteractiveApprovalManager.ts
  JsonRenderer.ts
  NdjsonRenderer.ts
  TextRenderer.ts
  ExitCodes.ts
  LocalAgentProvider.ts
  RunSummary.ts
  commands/
    AgentCommand.ts
    AgentsCommand.ts
    ApproveCommand.ts
    CancelCommand.ts
    ClearCommand.ts
    DebugCommand.ts
    ExitCommand.ts
    ExportCommand.ts
    HelpCommand.ts
    HistoryCommand.ts
    ModelCommand.ts
    PermissionsCommand.ts
    ResumeCommand.ts
    RejectCommand.ts
    SessionCommand.ts
    StatusCommand.ts
    TraceCommand.ts
    ToolsCommand.ts
```

Add executable entrypoints:

```text
src/cli/bin/chat.ts
src/cli/bin/console.ts
src/cli/bin/doctor.ts
```

The CLI should import runtime primitives from existing packages instead of duplicating behavior.

Add public CLI exports under a separate namespace from core runtime exports:

```ts
export * from './cli/ConsoleApp.js';
export * from './cli/ConsoleRuntimeFactory.js';
export * from './cli/ConsoleCommand.js';
export * from './cli/ConsoleCommandRegistry.js';
```

This allows downstream apps to reuse the CLI shell without forking it.

## Package Scripts

Add scripts to `package.json` after the CLI exists:

```json
{
  "scripts": {
    "chat": "node --env-file=.env dist/cli/bin/chat.js",
    "console": "node --env-file=.env dist/cli/bin/console.js",
    "doctor": "node --env-file=.env dist/cli/bin/doctor.js"
  }
}
```

Keep build-first execution for the initial version:

```powershell
yarn build
yarn chat -- "hello"
yarn console
yarn doctor
```

Fast paths must work without loading the full runtime:

```powershell
yarn chat -- --help
yarn console -- --help
yarn doctor -- --help
node dist/cli/bin/chat.js --version
```

Later, add a development runner only if needed.

## CLI Modes

Define explicit console modes:

```ts
export const ConsoleModes = {
  READY: 'ready',
  AGENT_RUNNING: 'agent_running',
  APPROVAL_WAITING: 'approval_waiting',
  QUEUED: 'queued',
  ERROR: 'error',
  EXITING: 'exiting',
} as const;
```

The mode should control input behavior:

- `READY`: user prompts run immediately.
- `AGENT_RUNNING`: new prompts are queued unless they are commands.
- `APPROVAL_WAITING`: approve/reject commands are allowed; ordinary prompts are queued.
- `ERROR`: status/debug/exit commands remain available.
- `EXITING`: readline loop closes.

The session must expose mode transitions as events:

```text
cli.mode.changed
cli.prompt.queued
cli.prompt.started
cli.prompt.completed
cli.prompt.cancelled
```

This makes console behavior replayable and testable.

## Command Model

Use slash commands for interactive console commands:

```text
/help
/status
/tools
/agent <id>
/agents
/model [model-id]
/session
/history
/approve <id>
/reject <id>
/cancel
/clear
/debug
/permissions
/resume <run-id>
/trace <run-id>
/export <run-id>
/exit
```

Command interface:

```ts
export interface ConsoleCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly usage: string;
  execute(input: ConsoleCommandInput, session: ConsoleSession): Promise<ConsoleCommandResult>;
}
```

Use a `ConsoleCommandRegistry` and `ConsoleCommandBus` like `minimal-agentic-runtime`, but make command results typed and stable.

Command results:

```ts
export type ConsoleCommandResult =
  | { readonly status: 'success'; readonly message?: string; readonly data?: unknown }
  | { readonly status: 'error'; readonly message: string; readonly errorCode: string; readonly data?: unknown }
  | { readonly status: 'exit'; readonly message?: string };
```

Command registration must be open for extension:

- built-in commands are registered by `createDefaultCommandRegistry`
- downstream apps can pass additional commands
- commands must declare whether they are allowed during `AGENT_RUNNING` or `APPROVAL_WAITING`
- command aliases must be tested

## One-Shot Chat Command

Add a non-interactive command:

```powershell
yarn chat -- --agent default "Summarize this runtime"
```

Required options:

```text
--agent <id>          Agent id, default: default
--storage <dir>       Persistence directory, default: .runtime
--model <model>       Overrides OPENAI_MODEL
--provider <name>     openai | mock, default: openai
--json                Print terminal result as JSON
--ndjson              Print runtime events as newline-delimited JSON
--debug               Print debug metadata and event summary
--no-color            Disable ANSI color
--cwd <dir>           Working directory for local agents/tools
--help
```

Behavior:

- Exit `0` on terminal status `success`.
- Exit `1` for validation/runtime/model/tool failures.
- Exit `130` for cancellation.
- In `--json` mode, print only machine-readable JSON to stdout and errors to stderr.
- In `--ndjson` mode, print event records as they occur and finish with a terminal result record.

Stable output records:

```ts
export type CliOutputRecord =
  | { readonly type: 'event'; readonly event: RuntimeEventRecord }
  | { readonly type: 'terminal_result'; readonly result: TerminalResult }
  | { readonly type: 'error'; readonly errorCode: string; readonly message: string };
```

This should be stronger than `claude-code-rev` for automation because output shape is documented and tested as a public contract.

## Interactive Console

Add:

```powershell
yarn console -- --agent default
```

The console should:

- Render a small banner with runtime version, active agent, session id, storage path, model, and cwd.
- Accept natural-language prompts.
- Accept slash commands.
- Show runtime events in readable form.
- Show tool calls, tool failures, approval requests, and terminal results.
- Support Ctrl+C cancellation while an agent is running.
- Support Ctrl+C exit when no agent is running.
- Queue user prompts while a run is active.
- Support text, compact, JSON, and NDJSON renderer modes.
- Keep stdout reserved for intentional output and stderr for diagnostics in non-interactive modes.

Prompt:

```text
mela> 
```

## Runtime Factory

Create `ConsoleRuntimeFactory` to assemble runtime dependencies for CLI use.

Responsibilities:

- Load CLI config from args and environment.
- Create persistence store.
- Create event bus and observability recorder.
- Create model client.
- Create tool registry.
- Create policy engine.
- Create approval manager.
- Create `ConversationEngine`.
- Return a single `ConsoleRuntime` object for the session.
- Validate that required provider credentials exist before the first model call.
- Produce structured configuration diagnostics for `doctor`.

Shape:

```ts
export interface ConsoleRuntime {
  readonly conversationEngine: ConversationEngine;
  readonly store: PersistenceStore;
  readonly toolRegistry: RuntimeToolRegistry;
  readonly policyEngine: PolicyEngine;
  readonly approvalManager: InteractiveApprovalManager;
  readonly eventBus?: EventBus;
}
```

The factory should accept overrides for every major dependency:

```ts
export interface ConsoleRuntimeFactoryOverrides {
  readonly modelClient?: LLMClient;
  readonly store?: PersistenceStore;
  readonly toolRegistry?: RuntimeToolRegistry;
  readonly policyEngine?: PolicyEngine;
  readonly approvalManager?: ApprovalRequester;
  readonly agentProvider?: AgentProvider;
}
```

This makes the CLI easy to test and easy to embed.

## Environment Loading

The CLI may load `.env`; the core runtime must not.

Add `DotEnvLoader.ts` with a small dependency-free parser inspired by `minimal-agentic-runtime`.

Supported:

- `KEY=value`
- blank lines
- comments
- quoted values
- do not override existing `process.env` values by default

Required environment variables for OpenAI mode:

```text
OPENAI_API_KEY
```

Optional:

```text
OPENAI_MODEL=gpt-5.4-mini
MELA_RUNTIME_STORAGE=.runtime
MELA_RUNTIME_AGENT=default
MELA_RUNTIME_PROVIDER=openai
```

Also add:

```text
.env.example
.gitignore
```

`.gitignore` must include:

```text
node_modules
dist
.env
.env.*
!.env.example
.runtime
```

`doctor` must warn when `.env` exists but `.gitignore` does not protect it.

## Model Provider Integration

The CLI should use the runtime's `LLMClient` abstraction.

Add OpenAI client separately from the CLI:

```text
src/models/OpenAIClient.ts
```

Then the CLI can select providers:

```ts
if (config.provider === 'openai') return createOpenAIClient(...);
if (config.provider === 'mock') return createMockLLMClient(...);
```

Initial OpenAI support:

- Text responses.
- Function/tool-call mapping.
- Usage mapping.
- Abort signal support.
- Clear non-2xx error messages.

Do not require OpenAI integration tests to run by default.

Provider contract:

```ts
export interface CliModelProvider {
  readonly name: string;
  createClient(config: CliConfig): Promise<LLMClient>;
  validateConfig(config: CliConfig): readonly CliDiagnostic[];
}
```

Initial providers:

- `mock`
- `openai`

Future providers:

- `anthropic`
- `azure-openai`
- custom provider from host application

The CLI should not hard-code provider-specific behavior outside provider modules.

## Agent Loading

Mela currently accepts `AgentDefinition` directly. The CLI needs a local provider.

Add:

```text
src/cli/LocalAgentProvider.ts
```

Recommended format:

```text
agents/
  default.md
```

Example:

```md
---
id: default
name: Default Agent
version: 1.0.0
description: General-purpose CLI agent.
skills: []
tools:
  allow: []
  deny: []
---

# Role

You are a helpful runtime test agent.

# Workflow

1. Understand the request.
2. Use available context.
3. Return a concise answer.

# Output Contract

Return a clear answer.
```

Agent loading must support validation diagnostics:

- missing file
- invalid JSON
- missing id/version/system prompt
- invalid model config
- tool referenced by agent but not registered
- unsafe limits

`doctor` should run these checks without making a model call.

## Interactive Approval Flow

Use the existing approval abstractions but add CLI-specific behavior.

When approval is requested:

- Render approval id.
- Render tool name.
- Render risk/reason.
- Render proposed input.
- Move session to `APPROVAL_WAITING`.

Commands:

```text
/approve <id>
/reject <id>
```

The first version can handle one pending approval at a time. The second version should support multiple pending approvals through a queue.

Approval records must include:

- approval id
- run id
- session id
- tool name
- original input
- final approved input if edited
- decision
- reviewer identity if available
- reason code
- timestamp

Approval UX should be better than `claude-code-rev` for runtime reuse by keeping the approval prompt and the persisted approval record based on the same typed data.

## Rendering

Keep the first renderer plain and dependency-free.

Render these event types clearly:

- run started/completed/failed/cancelled
- model request started/completed/failed
- tool call requested/completed/failed
- approval requested/approved/rejected
- child run requested/completed/cancelled
- output replaced

Add `--json` only for one-shot chat at first. Add structured interactive event output later if useful.

Renderer contract:

```ts
export interface ConsoleRenderer {
  renderBanner(input: ConsoleBannerInput): void;
  renderEvent(event: RuntimeEventRecord): void;
  renderCommandResult(result: ConsoleCommandResult): void;
  renderTerminalResult(result: TerminalResult): void;
  renderError(error: CliError): void;
}
```

Renderers:

- `TextRenderer`: human-friendly default.
- `JsonRenderer`: one final JSON object for automation.
- `NdjsonRenderer`: streaming event records for automation.
- `SilentRenderer`: tests and embedding.

Renderer output must be snapshot-tested.

## Persistence and Sessions

Default storage:

```text
.runtime
```

Session commands:

```text
/session
/history
/clear
```

Future commands:

```text
/resume <run-id>
/replay <run-id>
/export <run-id>
```

The CLI should store:

- messages
- tool calls
- approvals
- runtime events
- terminal results
- run snapshots

Session metadata should include:

- CLI version
- runtime version
- provider
- model
- cwd
- active agent id
- permission mode
- started timestamp

Export format:

```ts
export interface CliRunExport {
  readonly schemaVersion: 'mela.cli.run-export.v1';
  readonly session: unknown;
  readonly messages: readonly unknown[];
  readonly toolCalls: readonly unknown[];
  readonly approvals: readonly unknown[];
  readonly events: readonly RuntimeEventRecord[];
  readonly terminalResult?: TerminalResult;
}
```

This gives Mela a clearer replay/debug artifact than a product-specific session log.

## Safety and Permissions

The CLI should default to conservative behavior.

Initial policy:

- No dangerous shell/file mutation tools should be registered by default.
- Approval manager defaults to reject if interactive approval is unavailable.
- Tool policy should support deny and approval-required tools from config.
- Default mode is `read-only`.
- Every permission denial or approval request must include a reason code.

Future policy commands:

```text
/permissions
/mode read-only
/mode safe-write
/mode unrestricted
```

Borrow the idea from `claude-code-rev`: permission mode should be visible in `/status` and every approval prompt should explain the reason.

Permission modes:

```text
read-only       Read/search/list operations only.
ask             Ask before any tool marked as risky or mutating.
safe-write      Allow low-risk writes; ask for destructive/external actions.
unrestricted    Allow all registered tools unless explicitly denied.
```

The first implementation may only enforce `read-only` and `ask`, but the types should support all modes.

Safety diagnostics:

- provider key missing
- `.env` unprotected
- unrestricted mode enabled
- unknown tools referenced by an agent
- writable tools registered in read-only mode
- storage path outside cwd unless explicitly allowed

## Cancellation

Implement `ConsoleCancellation`.

Requirements:

- One active `AbortController` per active run.
- Ctrl+C cancels the active run.
- `/cancel` cancels the active run.
- A second Ctrl+C while no run is active exits.
- Cancellation should produce a terminal result or clear user-facing message.

Cancellation should also:

- abort active model call
- abort active tool calls when tools honor the signal
- mark queued prompts as still queued, not cancelled
- record cancellation reason in session history
- exit with code `130` in one-shot mode

## Debug and Observability

Add `/debug`.

It should show:

- active session id
- active run id if any
- model/provider
- active agent id
- runtime mode
- queue length
- last terminal status
- recent event count by type
- tool names
- storage path

Later:

- `/trace <run-id>`
- `/events <run-id>`
- `/tool-call <id>`

Add `doctor` as a non-interactive diagnostic command:

```powershell
yarn doctor
```

Checks:

- Node version
- package version
- build output exists
- `.env` exists and is protected
- provider config is valid
- OpenAI key shape is present without printing it
- storage path is writable
- default agent can be loaded
- referenced tools are registered
- tests can be run without live credentials

`doctor --json` should produce machine-readable diagnostics.

## Testing Plan

Add unit tests for:

- CLI arg parsing.
- `.env` loading.
- command registry aliases.
- command bus dispatch.
- input parser.
- session mode transitions.
- prompt queue behavior.
- cancellation behavior.
- approval approve/reject behavior.
- renderer output snapshots for key events.
- one-shot chat exit behavior.
- JSON and NDJSON output contracts.
- provider config diagnostics.
- local agent validation diagnostics.
- permission mode behavior.
- `doctor` checks.

Add integration tests with mock model:

- one-shot chat success.
- one-shot chat model failure.
- interactive prompt success.
- tool approval rejected.
- cancellation while running.
- JSON one-shot output.
- NDJSON event streaming.
- resume/export command skeletons.

Add opt-in live OpenAI smoke test:

```text
RUN_OPENAI_INTEGRATION=1
OPENAI_API_KEY=...
```

This test must be skipped by default.

## Implementation Phases

### Phase 1: CLI Skeleton

- Add `.gitignore` and `.env.example`.
- Add `DotEnvLoader`.
- Add `CliArgs` and `CliConfig`.
- Add `chat` and `console` bin entrypoints.
- Add `doctor` bin entrypoint.
- Add `ExitCodes`.
- Add text/json/ndjson renderer contracts.
- Add package scripts.
- Add basic tests.

Acceptance:

- `yarn build` passes.
- `yarn test:unit` passes.
- `yarn chat -- --help` works.
- `yarn console -- --help` works.
- `yarn doctor -- --help` works.
- fast-path help/version commands do not create runtime dependencies.

### Phase 2: Console Core

- Add `ConsoleApp`.
- Add `ConsoleSession`.
- Add `ConsoleMode`.
- Add `ConsoleRenderer`.
- Add command registry, bus, queue, and parser.
- Add basic commands: `/help`, `/exit`, `/status`, `/clear`, `/history`.
- Add renderer snapshot tests.

Acceptance:

- Console starts.
- Natural-language input reaches a mock runtime.
- Slash commands work.
- Ctrl+C exits when idle.
- command behavior is testable without a real terminal.

### Phase 3: Runtime Wiring

- Add `ConsoleRuntimeFactory`.
- Add local agent JSON provider.
- Wire `ConversationEngine`.
- Wire `InMemoryStore` or `FileStore`.
- Wire tool registry.
- Wire event rendering.
- Add `doctor` diagnostics for runtime assembly.

Acceptance:

- `yarn chat -- "hello"` runs against mock provider.
- `yarn console` runs a prompt against mock provider.
- `/status` shows runtime details.
- `yarn doctor` validates local config without making a model call.

### Phase 4: OpenAI Provider

- Add `OpenAIClient`.
- Add `CliModelProvider` abstraction.
- Add OpenAI text response mapping.
- Add function/tool-call mapping.
- Add usage mapping.
- Add opt-in OpenAI integration test.

Acceptance:

- `OPENAI_API_KEY` is read by CLI.
- `yarn chat -- --provider openai "hello"` works after build.
- Unit tests do not require network or API keys.
- OpenAI provider can be swapped for mock without changing CLI shell code.

### Phase 5: Approvals, Cancellation, and Tools

- Add `InteractiveApprovalManager`.
- Add `/approve`, `/reject`, `/cancel`, `/tools`.
- Add `/permissions`.
- Render approval requests.
- Add queued prompt behavior while agent is running.
- Persist typed approval audit records.

Acceptance:

- Tool approval can be approved/rejected interactively.
- Ctrl+C cancels the active run.
- `/tools` lists registered tools.
- approval and rejection are visible in persisted events.

### Phase 6: Production CLI Polish

- Add `/debug`.
- Add `--json` one-shot output.
- Add `--ndjson` event output.
- Add event summaries.
- Add better errors for missing `.env`, missing agent, invalid model, and missing provider.
- Add `/trace`, `/export`, and `/resume` skeletons.
- Add `doctor --json`.

Acceptance:

- CLI is usable for local runtime development.
- Failures are understandable.
- Tests cover happy path, failure path, cancellation, approval, and configuration.
- Automation output is stable and documented.

### Phase 7: Better-Than-Claude Hardening

- Add documented CLI extension API.
- Add run export schema.
- Add replay/debug artifact reader.
- Add permission mode enforcement.
- Add provider diagnostic registry.
- Add command capability metadata.
- Add startup performance tests for fast paths.

Acceptance:

- Adding a command does not require editing `ConsoleApp`.
- Adding a provider does not require editing command handlers.
- `doctor --json` can be consumed by another program.
- permission decisions are fully auditable.
- CLI startup fast paths are covered by tests.

## Success Criteria

The CLI module is ready when:

- It can run one-shot prompts.
- It can run an interactive console.
- It can load local `.env` safely.
- It can use OpenAI through the runtime `LLMClient` interface.
- It can run with a mock model without network access.
- It exposes status, history, tools, approvals, cancellation, and debug commands.
- It has extensive unit and integration tests.
- It does not weaken the core runtime package boundaries.
- It has stable JSON and NDJSON output contracts.
- It exposes a reusable command/provider/renderer extension API.
- It has a `doctor` command for configuration and safety diagnostics.
- It records auditable approval and permission decisions.
- It can export run/session data in a documented schema.

## Better-Than-Claude Checklist

Mela CLI should be considered better than `claude-code-rev` as a reusable runtime CLI when all of these are true:

- CLI shell, runtime assembly, and core runtime are cleanly separated.
- The CLI can be embedded by another application without inheriting product-specific services.
- All commands are registered through an extension-safe command registry.
- All providers implement a common provider contract.
- JSON and NDJSON outputs are stable, documented, and tested.
- Normal tests require no API key, network, real terminal, or external service.
- Permission decisions are stored as typed data, not only rendered UI state.
- `.env` handling is local to the CLI and includes secret-safety diagnostics.
- Fast-path commands avoid loading the full runtime.
- Run export/replay artifacts are documented and versioned.
