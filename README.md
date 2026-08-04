# Mela Agentic Runtime

`@mela/runtime` — a standalone, provider-agnostic agentic runtime: a multi-turn tool-calling conversation engine, a Markdown-defined agent/skill/tool system, and a CLI (`chat` / `console` / `doctor`) built on top of it. Runtime types, IDs, events, and logger contracts are owned locally by this package — it has no sibling-package runtime dependencies.

## Contents

- [Requirements](#requirements)
- [Install and Build](#install-and-build)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Providers and Models](#providers-and-models)
- [Agents](#agents)
- [Skills](#skills)
- [Tools](#tools)
- [CLI Commands](#cli-commands)
- [Console Commands](#console-commands)
- [Persistence](#persistence)
- [Using It as a Library](#using-it-as-a-library)
- [Development](#development)
- [Project Structure](#project-structure)

## Requirements

- Node.js `>=20`
- Yarn `4.6.0` (this repo uses Yarn Berry / PnP — always run scripts via `yarn <script>`, not bare `node`, or module resolution for devDependencies like `typescript` will fail)

## Install and Build

```sh
yarn install
yarn build       # tsc --project tsconfig.build.json -> dist/
```

The `chat`/`console`/`doctor` scripts run compiled output from `dist/`, so re-run `yarn build` after any source change before using them (`yarn typecheck`/`yarn test` run directly against `src/` and don't need a build).

## Quick Start

1. Copy the example env file and fill in at least one provider's API key:
   ```sh
   cp .env.example .env
   ```
2. Build:
   ```sh
   yarn build
   ```
3. Start the interactive console:
   ```sh
   yarn console
   ```
   ```text
   Mela Agentic Runtime
   agent=default session=session_...
   provider=openai model=gpt-5.4-mini
   storage=.runtime
   cwd=...

   mela> Hi
   [run] run.started
   [model] thinking...
   [run] run.completed
   Hi! How can I help?
   mela>
   ```
4. Or run a single one-shot prompt without the interactive loop:
   ```sh
   yarn chat "What tools do you have?"
   ```
5. Sanity-check your setup (agent loads, tools resolve, provider credentials present) without spending a model call:
   ```sh
   yarn doctor
   ```

## Configuration

`.env` file reference.

Loaded automatically by `chat`/`console`/`doctor` (`--env-file=.env` on the underlying `node` scripts; override the path with `--env <path>`). `loadDotEnv` only fills in variables **not already set** in the process environment — real shell/CI env vars always win over the file.

| Variable | Default | Meaning |
|---|---|---|
| `MELA_RUNTIME_PROVIDER` | `openai` | Which registered provider to use (`mock`, `openai`, `nvidia`, or a custom one you register) |
| `MELA_RUNTIME_MODEL` | *(none)* | Explicit model override — wins over every provider's own model list. Prefer `<PROVIDER>_MODELS` (below) over this so you don't have to keep it in sync when switching providers |
| `MELA_RUNTIME_AGENT` | `default` | Agent id to load from `agents/<id>.md` |
| `MELA_RUNTIME_STORAGE` | `.runtime` | Persistence directory (see [Persistence](#persistence)) |
| `MELA_RUNTIME_TOOLS` | `tools` | Directory of local tool modules |
| `OPENAI_API_KEY` | — | Required to use the `openai` provider |
| `OPENAI_MODELS` | *(curated: `gpt-5.4-mini,gpt-5.4`)* | Comma-separated model ids OpenAI registers; **the first one is the provider's default model** |
| `OPENAI_MODEL` | — | Legacy single-model fallback, only consulted if `OPENAI_MODELS` is unset |
| `NVIDIA_API_KEY` | — | Required to use the `nvidia` provider (get one at [build.nvidia.com](https://build.nvidia.com)) |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |
| `NVIDIA_MODELS` | *(curated defaults — see `.env.example`)* | Comma-separated NIM model ids; first one is the provider's default model |
| `MELA_INGESTION_BASE_URL` / `_BEARER_TOKEN` / `_API_KEY` | — | Optional — enables the `pdf_ingest` tool against an ingestion service |

See `.env.example` for a filled-in template.

## Providers and Models

Three providers are registered out of the box: `mock` (canned responses, no network — good for tests/CI), `openai`, and `nvidia`. Both real providers speak a chat-completions-style API over plain `fetch` (no SDK dependency).

**Choosing a provider/model**, highest precedence first:
1. `--provider` / `--model` CLI flags (or `MELA_RUNTIME_PROVIDER` / `MELA_RUNTIME_MODEL` env)
2. The active agent's own declared `model:` frontmatter (see [Agents](#agents))
3. The resolved provider's own first registered model (`<PROVIDER>_MODELS[0]`)
4. Hardcoded fallback (`openai` / `gpt-5.4-mini`)

This means the common case needs almost no configuration: set `MELA_RUNTIME_PROVIDER=nvidia` and `NVIDIA_MODELS=your-model,...` in `.env`, and every agent that doesn't declare its own model uses `NVIDIA_MODELS[0]` automatically — switching providers is a one-line `.env` change, not a per-agent edit.

```sh
# one-off override for a single invocation
yarn chat --provider nvidia --model meta/llama-3.1-70b-instruct "hello"

# persistent default via .env
MELA_RUNTIME_PROVIDER=nvidia
NVIDIA_MODELS=meta/llama-3.1-70b-instruct,meta/llama-3.1-405b-instruct
```

Run `/models` in the console (or see [Console Commands](#console-commands)) to see every registered provider, its model list, and which one is currently active.

Registering more models never requires a code change — it's a comma-separated env var. Adding a new *provider* (e.g. a different OpenAI-compatible endpoint) does require code: a new client under `src/models/`, registered in `src/cli/CliModelProvider.ts`.

## Agents

Agents are Markdown files in `agents/<id>.md` — YAML frontmatter + a system-prompt body.

```md
---
id: default
name: Default CLI Agent
version: 1.0.0
description: General-purpose agent for local CLI use.
skills:
  - gather-context
  - validate-output
tools:
  allow:
    - arxiv_search
    - pdf_ingest
  deny: []
model:                    # optional — omit to use the CLI/provider default
  provider: nvidia
  model: meta/llama-3.1-405b-instruct
  temperature: 0.1
---

# Role

You are a concise, helpful CLI agent...

# Workflow

1. ...

# Output Contract

Return a clear answer. If information is missing, say what is missing.
```

| Frontmatter field | Required | Notes |
|---|---|---|
| `id`, `name` | yes | |
| `version`, `description` | no | |
| `skills` | no | List of skill ids from `skills/<id>.md` |
| `tools.allow` / `tools.deny` | no | Tool names this agent may use; a tool can't be both allowed and denied |
| `model.provider` / `model.model` / `model.maxTokens` / `model.temperature` | no | All optional — see precedence above. Omit the whole block to just inherit the CLI/provider default |

The body's `# Role` / `# Workflow` / `# Output Contract` sections (if present) are concatenated into the system prompt; otherwise the whole body is used verbatim.

List available agents: `/agents` in the console, or `ls agents/`.

## Skills

Skills are Markdown files in `skills/<id>.md`, referenced by an agent's `skills:` list:

```md
---
id: gather-context
name: Gather Context
version: 1.0.0
description: Gather focused context before answering.
allowed_tools:
  - arxiv_search
  - pdf_ingest
invocation_mode: preload   # preload | invoke | both
---

# Instructions
...
```

List the active agent's skills: `/skills` in the console.

## Tools

Tools are TypeScript modules in `tools/<name>.ts` (default `MELA_RUNTIME_TOOLS=tools`), exporting a `RuntimeTool` as `default`:

```ts
const readTool: RuntimeTool<{ path: string }, { text: string }> = {
  name: 'file_read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  timeoutMs: 5000,
  concurrencySafe: true,
  validateInput(input) { /* ... */ },
  checkPermissions: async () => ({ decision: 'allow' }),
  execute: async (input) => ({ ok: true, output: { text: input.path } }),
  mapResultToModel: createDefaultToolResultMapper(),
};
export default readTool;
```

Loaded automatically by the CLI (`LocalToolModuleProvider`); an agent opts into a tool via its `tools.allow` list. Tool output larger than a configured byte ceiling is truncated to a preview rather than sent to the model in full (`budgetToolOutput`).

Built-in tools shipped in this repo: `arxiv_search`, `pdf_ingest`, `proof_audit`, `web_read`, `web_search` (see `tools/*.ts`).

## CLI Commands

Covers `yarn chat`, `yarn console`, and `yarn doctor`.

### `yarn chat -- [options] "prompt"`

One-shot: submit a single prompt, print the terminal result, exit.

```text
--agent <id>       Agent id, default default
--storage <dir>    Runtime persistence directory, default .runtime
--provider <name>  mock | openai | nvidia, default openai
--model <id>       Model id (see Providers & Models precedence)
--cwd <dir>        Working directory, default process cwd
--env <path>       Env file, default .env
--tools <dir>      Tool implementation directory, default tools
--json             Print the final result as JSON
--ndjson           Stream events and the final result as NDJSON
--debug            Include debug metadata
--no-color         Disable color
--help             Show help
```
Exit code: `0` success, `1` failure, `130` cancelled.

### `yarn console -- [options]`

Starts the interactive REPL (prompt: `mela> `). Same `--agent`/`--storage`/`--provider`/`--model`/`--cwd`/`--env`/`--tools`/`--help` flags as `chat`. Plain text (not starting with `/`) is sent to the agent; anything starting with `/` is a [console command](#console-commands). `Ctrl+C` cancels an active run, or exits if idle.

### `yarn doctor -- [options]`

Runs diagnostics without spending a model call: provider credentials present/missing, agent loads, referenced skills load, tool modules found. Same flags as `console`, plus `--json` to print diagnostics as JSON. Exit code `1` if any diagnostic is `error`-level.

```sh
yarn doctor --provider nvidia
```
```text
INFO node_version: Node v22.11.0
ERROR missing_nvidia_api_key: NVIDIA_API_KEY is not set.
INFO agent_loaded: Agent "default" loaded successfully.
INFO skill_loaded: Skill "gather-context" loaded successfully.
INFO tool_modules_loaded: 5 tool module(s) found.
```

## Console Commands

Typed inside `yarn console` (`/` prefix). Some are blocked while an agent run is active or an approval is pending — noted below.

| Command | Aliases | Description | Blocked while running? | Blocked while approval pending? |
|---|---|---|---|---|
| `/help` | `/h`, `/?` | List all commands | no | no |
| `/status` | | Session/runtime status (agent id, provider/model overrides, storage, mode, tool count, last result) | no | no |
| `/agents` | | List available local Markdown agents | no | no |
| `/models` | | List every registered provider and its models, with `active` flags for the one currently in use | no | no |
| `/skills` | | List skills referenced by the active agent | no | no |
| `/tools` | | List registered tool names | no | no |
| `/history` | | Show local console history for this session | no | no |
| `/debug` | | Status plus event-bus stats | no | no |
| `/cancel` | | Cancel the active run | no | no |
| `/approve` | | Approve the pending tool-approval request | — | no |
| `/reject [reason]` | | Reject the pending tool-approval request | — | no |
| `/clear` | | Clear local console history and any queued prompts | **yes** | **yes** |
| `/exit` | `/quit`, `/q` | Exit the console | no | no |

A prompt sent while a run is already active is queued (`session.queue`, visible via `/status`'s `queueLength`) instead of rejected — but nothing currently drains that queue automatically once the run finishes; queued prompts sit there until `/clear` empties it or the process restarts. Treat this as a known gap, not an auto-continue feature.

## Persistence

Each session writes to `<storagePath>/sessions/<sessionId>/` (default `.runtime/sessions/...`):
- `events.jsonl` — every runtime event for the session (append-only)
- `messages.jsonl` — every raw message sent/received across every run in the session (append-only; this is the full audit trail, independent of whatever an interactive console keeps in memory)

Swap the backend by implementing `PersistenceStore` — the default is `FileStore`, writing to disk as above; `InMemoryStore` is available for tests/ephemeral use.

## Using It as a Library

Everything above is a thin CLI over an embeddable runtime. Import what you need from `@mela/runtime` (`src/index.ts` is the full public surface):

```ts
import {
  ConversationEngine,
  RuntimeToolRegistry,
  createOpenAIClient,
  createNvidiaClient,
  createDefaultModelProviders,
  ConsoleRuntimeFactory,
  createCliConfig,
} from '@mela/runtime';
```

Notable extension points, all designed to be swapped via constructor injection rather than editing runtime code (open/closed):
- `LLMClient` — provider transport contract; compose with `createRetryingLLMClient`, `createFallbackLLMClient`, or `createRoutingLLMClient` for retry/failover/multi-provider routing.
- `CliModelProvider` — register a custom model provider via `ConsoleRuntimeFactoryOverrides.modelProviders`.
- `PersistenceStore` — swap storage backends.
- `ApprovalRequester` / `PolicyEngine` — customize human-in-the-loop and tool-permission behavior.

## Development

```sh
yarn typecheck     # tsc --noEmit
yarn test          # vitest run (alias: yarn test:unit)
yarn build         # compile src/ -> dist/
yarn clean         # remove dist/ and tsbuildinfo
```

Tests are fully offline — provider clients are exercised with `fetch` stubbed via `vi.stubGlobal`, never a live network call.

## Project Structure

```text
agents/         Agent Markdown definitions (agents/<id>.md)
skills/         Skill Markdown definitions (skills/<id>.md)
tools/          Local TypeScript tool modules (tools/<name>.ts)
src/
  agents/       AgentRegistry, ChildRunManager (sub-agent delegation)
  cli/          CLI: config, args, commands, console REPL, renderers, provider registry
    bin/        chat.ts / console.ts / doctor.ts entrypoints
    commands/   Console slash-command definitions
  context/      Token estimation, context budget enforcement, tool-output budgeting
  definitions/  Markdown frontmatter parsing for agents/skills
  human/        Approval manager, review queue
  models/       LLMClient contract + provider implementations (OpenAI, NVIDIA/OpenAI-compatible)
  observability/ Event bus
  persistence/  PersistenceStore + FileStore/InMemoryStore
  policy/       PolicyEngine
  runtime/      ConversationEngine, RunContext, RuntimeEvents, TerminalResult
  safety/       Resource tracking, circuit breaker
  tools/        RuntimeTool contract, ToolExecutor, RuntimeToolRegistry
  types/        Shared runtime types
  validation/   Output validation pipeline
  workflows/    Workflow orchestration
  index.ts      Public package entrypoint
```
