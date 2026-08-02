# NVIDIA Model Provider Integration Plan

## 1. Goal

Add NVIDIA NIM (`https://build.nvidia.com`) as a second first-class model provider alongside OpenAI, selectable at runtime (CLI flag or env var), **without modifying** the runtime engine or the existing OpenAI provider — as a pure extension.

The current default model is OpenAI (`gpt-5.4-mini`, not GPT‑4/GPT‑3-era — see [CliConfig.ts:22](../src/cli/CliConfig.ts#L22)). This is not "OpenAI-only by design" — it's already provider-agnostic; NVIDIA just isn't registered yet.

## 2. Current architecture (verified, not assumed)

The codebase already has the exact seam this task needs:

- **[LLMClient](../src/models/LLMClient.ts)** — a provider-agnostic contract (`call` / `stream`). [ConversationEngine](../src/runtime/ConversationEngine.ts#L151) depends only on this interface (dependency inversion) — it has zero knowledge of "OpenAI" vs anything else.
- **[OpenAIClient.ts](../src/models/OpenAIClient.ts)** — one concrete `createOpenAIClient(config): LLMClient`, plain `fetch`, no SDK.
- **[CliModelProvider.ts](../src/cli/CliModelProvider.ts)** — a Strategy/Registry: `CliModelProvider { name, createClient, validateConfig }`. `createDefaultModelProviders()` returns `[mockProvider(), openAIProvider()]`; `resolveModelProvider(name, providers)` looks a provider up by name.
- **[ConsoleRuntimeFactory](../src/cli/ConsoleRuntimeFactory.ts#L42-L46)** resolves `config.provider` (a plain string) against that registry at runtime — this is already the "switch at will" mechanism: `--provider openai` vs `--provider nvidia`, or `MELA_RUNTIME_PROVIDER` in `.env`.
- `doctor` ([DoctorCommand.ts](../src/cli/DoctorCommand.ts)) automatically validates whichever provider is configured, for free, via the same `validateConfig` contract.
- **No runtime npm dependencies exist** — `package.json` has zero `dependencies`, only `devDependencies`. All HTTP calls use native `fetch`. Adding NVIDIA needs **no new package**.
- This is intentional, per [docs/cli-module-implementation-plan.md](cli-module-implementation-plan.md) (lines ~460-508, ~967-997): "Future providers: anthropic, azure-openai, custom provider..."; "Adding a provider does not require editing command handlers."; "All providers implement a common provider contract."

**Conclusion: the extension point already exists.** This plan plugs into it — it does not build it from scratch.

## 3. The one real technical wrinkle

`OpenAIClient.ts` targets OpenAI's newer **Responses API** (`POST /v1/responses`, with `instructions` / `input` / `output_text` / `function_call` items — see [OpenAIClient.ts:66-138](../src/models/OpenAIClient.ts#L66-L138)).

NVIDIA's `build.nvidia.com` endpoint is OpenAI-compatible via the classic **Chat Completions API** (`POST /v1/chat/completions`, with `messages` / `choices[0].message` / `tool_calls`). So the NVIDIA client **cannot** just reuse `createOpenAIClient` with a different `baseUrl` — the wire format differs and needs its own mapper.

Chat Completions is also the shape spoken by many other OpenAI-compatible endpoints (Groq, Together, local vLLM/Ollama-in-OpenAI-mode, Azure OpenAI's chat deployments). Building one **generic, reusable chat-completions client factory** now pays for itself immediately (NVIDIA) and keeps the door open for the next such provider at near-zero marginal cost — directly in the spirit of open/closed.

## 4. Design — SOLID mapping

| Principle | How this plan satisfies it |
|---|---|
| **S**ingle Responsibility | One file per concern: generic chat-completions wire mapping, NVIDIA-specific defaults, provider registration/env wiring, CLI help text. Each changes for exactly one reason. |
| **O**pen/Closed | Adding NVIDIA (or provider #3 later) never requires editing `ConversationEngine`, `OpenAIClient.ts`, or any other provider. Only *new* files plus *one* array entry in `createDefaultModelProviders()`. |
| **L**iskov Substitution | `NvidiaClient` satisfies the exact same `LLMClient` contract as `OpenAIClient`/mock. `ConversationEngine`, `createRetryingLLMClient`, `createFallbackLLMClient` all work against it unmodified — no special-casing by provider anywhere downstream. |
| **I**nterface Segregation | `LLMClient` stays minimal (`call`/`stream`). No NVIDIA-specific methods leak into the shared interface; NVIDIA-only config (e.g. `baseUrl` override) lives in `NvidiaClientConfig`, not in `LLMClient`. |
| **D**ependency Inversion | `ConversationEngine` and `ConsoleRuntimeFactory` depend only on the `LLMClient` / `CliModelProvider` abstractions, never on concrete provider classes. |

## 5. Proposed file changes

### New: `src/models/OpenAICompatibleChatClient.ts`

Generic factory:

```ts
export interface OpenAICompatibleChatClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;       // no default here — the caller (e.g. NvidiaClient) supplies it
  readonly provider: string;      // metadata.provider label, e.g. 'nvidia'
  readonly headers?: Record<string, string>;
}

export function createOpenAICompatibleChatClient(config: OpenAICompatibleChatClientConfig): LLMClient
```

Implements the `/chat/completions` request/response mapping: `messages` array (system role passes through as-is, unlike the Responses API's `instructions` split), `tools` → OpenAI function-calling schema, `choices[0].message.tool_calls` → `ToolCallRequest[]`, `usage.prompt_tokens/completion_tokens/total_tokens` → the shared `LLMResponse.usage` shape. Mirrors the `toOpenAIRequest`/`fromOpenAIResponse` pattern already in `OpenAIClient.ts`, just for the chat-completions wire format. No provider-specific defaults baked in — this file has no idea "NVIDIA" exists.

### New: `src/models/NvidiaClient.ts`

Thin wrapper, same pattern as `OpenAIClient.ts`'s exported shape:

```ts
export interface NvidiaClientConfig {
  readonly apiKey: string;
  readonly baseUrl?: string; // defaults to https://integrate.api.nvidia.com/v1
}

export function createNvidiaClient(config: NvidiaClientConfig): LLMClient {
  return createOpenAICompatibleChatClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://integrate.api.nvidia.com/v1',
    provider: 'nvidia',
  });
}
```

Kept as its own module (not inlined into the registry) so NVIDIA-specific quirks discovered later — different default headers, different tool-schema normalization — have a home without touching the generic mapper or other providers.

### Modify: `src/cli/CliModelProvider.ts`

Add `nvidiaProvider()`, mirroring `openAIProvider()` exactly ([CliModelProvider.ts:41-59](../src/cli/CliModelProvider.ts#L41-L59)):

```ts
function nvidiaProvider(): CliModelProvider {
  return {
    name: 'nvidia',
    async createClient(_config, env = process.env) {
      const apiKey = env.NVIDIA_API_KEY;
      if (!apiKey) throw new CliError('missing_nvidia_api_key', 'NVIDIA_API_KEY is required for provider "nvidia".');
      return createNvidiaClient({ apiKey, baseUrl: env.NVIDIA_BASE_URL });
    },
    validateConfig(_config, env = process.env) {
      const diagnostics: CliDiagnostic[] = [];
      if (!env.NVIDIA_API_KEY) {
        diagnostics.push({ level: 'error', code: 'missing_nvidia_api_key', message: 'NVIDIA_API_KEY is not set.' });
      } else {
        diagnostics.push({ level: 'info', code: 'nvidia_api_key_present', message: 'NVIDIA_API_KEY is set.' });
      }
      return diagnostics;
    },
  };
}
```

Register it: `createDefaultModelProviders()` → `[mockProvider(), openAIProvider(), nvidiaProvider()]`.

### Modify: `src/cli/CliConfig.ts` — decouple the model-default env var from OpenAI

Today the default-model fallback is hardcoded to an OpenAI-named env var ([CliConfig.ts:32](../src/cli/CliConfig.ts#L32)):

```ts
model: input.model ?? env.OPENAI_MODEL ?? DEFAULT_CLI_CONFIG.model,
```

If left as-is, every future provider would need its own special case bolted onto this shared file to get a sane default model — an open/closed violation. Fix, once, generically:

```ts
model: input.model ?? env.MELA_RUNTIME_MODEL ?? env.OPENAI_MODEL ?? DEFAULT_CLI_CONFIG.model,
```

`MELA_RUNTIME_MODEL` becomes the provider-neutral way to set a default model (works for NVIDIA, OpenAI, or anything added later); `OPENAI_MODEL` is kept purely as a backward-compatible fallback so existing `.env` files don't break. No `NVIDIA_MODEL` special-casing is added to `CliConfig.ts` — NVIDIA model selection goes through `--model` or `MELA_RUNTIME_MODEL`, same as any other provider. This is the **only** change to a file shared by all providers; it does not need to change again when provider #3 shows up.

### Modify: `src/index.ts` — export the provider seam

`CliModelProvider`, `createDefaultModelProviders`, and `resolveModelProvider` are currently **not exported** from the package root (only reachable via internal `./cli/CliModelProvider.js`). That means a host application embedding this runtime can't register a custom/NVIDIA provider through `ConsoleRuntimeFactoryOverrides.modelProviders` without importing an internal path. Fix as part of this work:

```ts
export { createDefaultModelProviders, resolveModelProvider } from './cli/CliModelProvider.js';
export type { CliModelProvider } from './cli/CliModelProvider.js';
export { createNvidiaClient } from './models/NvidiaClient.js';
export type { NvidiaClientConfig } from './models/NvidiaClient.js';
export { createOpenAICompatibleChatClient } from './models/OpenAICompatibleChatClient.js';
export type { OpenAICompatibleChatClientConfig } from './models/OpenAICompatibleChatClient.js';
```

### Modify: `.env.example`

```
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
# MELA_RUNTIME_PROVIDER=nvidia
# MELA_RUNTIME_MODEL=meta/llama-3.1-70b-instruct
```

### Modify: `src/cli/CliArgs.ts`

Update the three hardcoded `"mock | openai"` usage strings (`chatUsage()`, `consoleUsage()`, `doctorUsage()`) to `"mock | openai | nvidia"`. Cosmetic/discoverability only — `--provider nvidia` already parses today since the flag accepts a free string.

## 6. Testing plan

- `src/__tests__/openai-compatible-chat-client.test.ts` — fetch-stubbed (same pattern as the existing OpenAI test in [llm-client.test.ts](../src/__tests__/llm-client.test.ts#L77-L100)): assert the request hits `${baseUrl}/chat/completions`, request body has a `messages` array including the system message, tools map to the function-calling schema; assert response mapping pulls `choices[0].message.content`, `tool_calls`, and `usage`.
- `src/__tests__/nvidia-client.test.ts` — thin test confirming `createNvidiaClient` defaults `baseUrl` to `https://integrate.api.nvidia.com/v1` and sets `metadata.provider = 'nvidia'`; delegates wire-format correctness to the shared test above.
- Extend `src/__tests__/cli.test.ts` (or add a `CliModelProvider` test): `resolveModelProvider('nvidia', createDefaultModelProviders())` resolves; `validateConfig` without `NVIDIA_API_KEY` produces an `error` diagnostic, with it an `info` diagnostic — mirroring the existing OpenAI assertions.
- No live network calls, per existing convention (`fetch` is stubbed via `vi.stubGlobal`) — doctor/CI does not require real NVIDIA credentials to pass.

## 7. Switching providers "at will" (works once the above lands)

- Per-invocation: `yarn chat --provider nvidia --model meta/llama-3.1-70b-instruct "..."`
- Persistent default: `.env` → `MELA_RUNTIME_PROVIDER=nvidia`
- Programmatic (host app embedding the runtime): pass `provider: 'nvidia'` into `createCliConfig()`, or supply a custom `modelProviders` array to `ConsoleRuntimeFactoryOverrides` — including composing `createFallbackLLMClient([nvidiaClient, openAIClient])` for automatic failover. No changes to `ConversationEngine` or any provider file are needed for any of this.
- Per-agent, automatically, with no flag at all: see §8 — if the CLI flag/env isn't set, each agent's own declared `model.provider` wins.

## 8. Per-agent model & provider selection (routing)

### The problem — verified, not hypothetical

Two things in the current code actively prevent an agent definition from choosing its own model/provider:

1. **`AgentDefinitionLoader.manifestToAgentDefinition()` hardcodes the model block** — it never reads it from the agent's own frontmatter at all ([AgentDefinitionLoader.ts:56-61](../src/definitions/AgentDefinitionLoader.ts#L56-L61)):
   ```ts
   model: {
     provider: 'openai',
     model: 'gpt-5.4-mini',
     maxTokens: 2048,
     temperature: 0.2,
   },
   ```
   Neither `agents/default.md` nor `agents/aletheia-math.md` has a `model:` frontmatter field today, and `validateAgentFrontmatter` ([DefinitionSchemas.ts](../src/definitions/DefinitionSchemas.ts)) doesn't recognize one — there is currently no authoring surface for this at all.
2. Even if an agent *did* carry its own `model.provider`/`model.model`, **`ConsoleRuntimeFactory.loadAgent()` unconditionally overwrites both** with the CLI-level config on every load ([ConsoleRuntimeFactory.ts:102-112](../src/cli/ConsoleRuntimeFactory.ts#L102-L112)):
   ```ts
   return { ...agent, model: { ...agent.model, provider: config.provider, model: config.model } };
   ```
3. Structurally, `ConsoleRuntimeFactory.createRuntime()` resolves **one** provider and builds **one** `LLMClient`, injected once into `ConversationEngine` at session-start ([ConsoleRuntimeFactory.ts:42-46](../src/cli/ConsoleRuntimeFactory.ts#L42-L46)) — before any agent is loaded. So even fixing (1) and (2) wouldn't be enough on its own: if agent A wants NVIDIA and agent B wants OpenAI in the same running console, one fixed client can't serve both.

All three need to change together for "a specific agent can use one model or the other according to the agent definition" to actually work.

### Precedence rule

```
explicit --provider / --model flag (or MELA_RUNTIME_PROVIDER / MELA_RUNTIME_MODEL env)
  > agent definition's own model.provider / model.model
    > global default (openai / gpt-5.4-mini)
```

An explicit CLI override still wins — useful for "run this one agent against NVIDIA just this once" without editing its file — but when nothing is explicitly passed, the agent's own declared model takes over instead of silently defaulting to OpenAI as it does today.

### Design

**1. Let agents declare a model block.** Add an optional `model` frontmatter field, all sub-fields optional:

```yaml
---
id: research-agent
name: Research Agent
model:
  provider: nvidia
  model: meta/llama-3.1-405b-instruct
  temperature: 0.1
---
```

- `AgentManifest.model?: { provider?: string; model?: string; maxTokens?: number; temperature?: number }` ([AgentDefinitionLoader.ts:5-17](../src/definitions/AgentDefinitionLoader.ts#L5-L17)).
- `loadManifest()` reads `data.model` (guarded with the existing `isRecord()` helper, same pattern already used for `data.tools`).
- `manifestToAgentDefinition()` fills gaps with today's hardcoded values as the ultimate fallback: `provider: manifest.model?.provider ?? 'openai'`, etc. — fully backward compatible with `default.md`/`aletheia-math.md`, which declare no `model:` block and keep behaving exactly as they do now.
- `validateAgentFrontmatter()` gets a light shape check (if present, `model` must be a record; if `model.maxTokens`/`temperature` present, must be numbers) — same style as the existing `tools`/`skills` checks.

**2. Fix the precedence in `ConsoleRuntimeFactory.loadAgent()`.** Only override what was *explicitly* requested:

```ts
async loadAgent(config: CliConfig, runtime: ConsoleRuntime): Promise<AgentDefinition> {
  const agent = await runtime.agentProvider.load(config.agentId);
  return {
    ...agent,
    model: {
      ...agent.model,
      provider: config.provider ?? agent.model.provider ?? DEFAULT_CLI_CONFIG.provider,
      model: config.model ?? agent.model.model ?? DEFAULT_CLI_CONFIG.model,
    },
  };
}
```

This requires `CliConfig.provider` / `CliConfig.model` to mean "explicitly set" (i.e. become optional, `undefined` when the user passed neither a flag nor an env var), instead of always being pre-filled with `DEFAULT_CLI_CONFIG` values as they are today ([CliConfig.ts:27-41](../src/cli/CliConfig.ts#L27-L41)):

```ts
export interface CliConfig {
  // ...
  readonly provider?: CliProvider;   // was: readonly provider: CliProvider
  readonly model?: string;           // was: readonly model: string
}

export function createCliConfig(input, env = process.env): CliConfig {
  return {
    // ...
    provider: input.provider ?? env.MELA_RUNTIME_PROVIDER,               // no DEFAULT_CLI_CONFIG fallback here anymore
    model: input.model ?? env.MELA_RUNTIME_MODEL ?? env.OPENAI_MODEL,    // ditto
    // ...
  };
}
```
`DEFAULT_CLI_CONFIG.provider`/`.model` stay as constants, but are now only consulted at the point something concrete is needed (`loadAgent()`, `diagnose()`) — not baked in eagerly. This is a genuine, deliberate type-level breaking change (documented in "Caveats" below), not an oversight.

**3. Route each call to the right client instead of fixing one client per session.** Add a small composable routing client, in the same family as the existing `createFallbackLLMClient`/`createRetryingLLMClient` helpers in [LLMClient.ts](../src/models/LLMClient.ts#L103-L141):

```ts
// src/models/LLMClient.ts
export interface LLMClientResolver {
  resolve(providerHint: string | undefined): Promise<LLMClient>;
}

export function createRoutingLLMClient(resolver: LLMClientResolver): LLMClient {
  return {
    metadata: { provider: 'routed', supportsStreaming: true, supportsTools: true },
    async call(request) {
      const client = await resolver.resolve(request.metadata?.provider as string | undefined);
      return client.call(request);
    },
    async *stream(request) {
      const client = await resolver.resolve(request.metadata?.provider as string | undefined);
      yield* client.stream(request);
    },
  };
}
```

`LLMClient.ts` stays provider- and CLI-agnostic — it only knows "ask the resolver, delegate." The CLI-aware resolver implementation (knows about `CliModelProvider[]`, `CliConfig`, env, and lazily caches one client per provider name so e.g. NVIDIA credentials are only required if an NVIDIA-declaring agent is actually invoked) lives in a new `src/cli/ModelClientRouter.ts`:

```ts
export function createCliModelClientRouter(
  providers: readonly CliModelProvider[],
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env,
): LLMClientResolver {
  const cache = new Map<string, Promise<LLMClient>>();
  return {
    resolve(providerHint) {
      const name = providerHint ?? config.provider ?? DEFAULT_CLI_CONFIG.provider;
      if (!cache.has(name)) {
        cache.set(name, resolveModelProvider(name, providers).createClient(config, env));
      }
      return cache.get(name)!;
    },
  };
}
```

`ConsoleRuntimeFactory.createRuntime()` then builds the client via the router instead of resolving one provider eagerly ([ConsoleRuntimeFactory.ts:44-46](../src/cli/ConsoleRuntimeFactory.ts#L44-L46)):

```ts
const providers = this.overrides.modelProviders ?? createDefaultModelProviders();
const modelClient = this.overrides.modelClient ?? createRoutingLLMClient(createCliModelClientRouter(providers, config));
```
(`overrides.modelClient` — already used by tests, e.g. [cli.test.ts:143-190](../src/__tests__/cli.test.ts#L143-L190) — keeps bypassing all of this unchanged.)

**4. Tell the router which provider a given call wants.** The one small, additive touch to `ConversationEngine.ts`: pass the agent's resolved provider through the request's existing `metadata` field ([ConversationEngine.ts:152-158](../src/runtime/ConversationEngine.ts#L152-L158)):

```ts
const response = await this.deps.llmClient.call({
  model: agent.model.model,
  messages,
  maxTokens: agent.model.maxTokens,
  temperature: agent.model.temperature,
  tools: this.createToolSchemas(allowedTools),
  signal: context.signal,
  metadata: { provider: agent.model.provider },   // NEW — the only ConversationEngine change in this whole plan
});
```
`ConversationEngine` still depends only on the `LLMClient` interface — it has no idea a router or multiple providers exist underneath. DIP is intact.

### SOLID check

- **OCP**: adding an agent that wants NVIDIA is a frontmatter edit, not a code change. Adding provider #3 still only means new files + one registry entry (§4) — the router iterates `providers` generically.
- **LSP**: `createRoutingLLMClient`'s return value is a normal `LLMClient` — anywhere a single client was accepted (tests, `createFallbackLLMClient`, `createRetryingLLMClient`) a routed client works identically.
- **SRP**: `LLMClient.ts` knows generic client composition (retry/fallback/routing); `ModelClientRouter.ts` knows CLI-specific resolution/caching; `ConsoleRuntimeFactory` just wires them together. Each has one reason to change.

### Testing

- `AgentDefinitionLoader` test: a markdown fixture with a `model:` frontmatter block (`provider: nvidia`, `model: meta/llama-3.1-405b-instruct`, `temperature: 0.1`) parses into the matching `AgentManifest.model` / `AgentDefinition.model` fields; a fixture with **no** `model:` block still produces today's hardcoded defaults (`openai` / `gpt-5.4-mini` / `2048` / `0.2`) — a regression guard for `default.md` / `aletheia-math.md`, which have no `model:` block today.
- `validateAgentFrontmatter` test: `model` present but not a record → error; `model.temperature` present but not a number → error; a well-formed `model:` block → no errors.
- `ConsoleRuntimeFactory.loadAgent()` precedence test, three cases: (1) no CLI flag, agent declares `provider: nvidia` → resolved `model.provider === 'nvidia'`; (2) CLI flag `--provider openai` + agent declares `nvidia` → the flag wins, resolved `model.provider === 'openai'`; (3) neither the flag nor the agent declares a provider → falls back to `DEFAULT_CLI_CONFIG.provider`. All three legs of the precedence chain need their own assertion — a test that only checks the "flag wins" case would pass even if agent-level declaration were silently ignored again.
- `createCliModelClientRouter` / `createRoutingLLMClient` — the riskiest new runtime logic in this plan (new caching + dispatch behavior with no other test exercising it end-to-end), so it gets three targeted tests:
  1. **Dispatch**: two fake `CliModelProvider`s (`fast-fake`, `slow-fake`) backed by two distinct mock `LLMClient`s; call the routed client with `metadata: { provider: 'fast-fake' }` then with `metadata: { provider: 'slow-fake' }`; assert each underlying client received exactly the call meant for it. Proves routing actually dispatches, not just that *some* client answers.
  2. **Caching**: wrap a provider's `createClient` in a `vi.fn()` spy; call the router twice with the same provider hint; assert `createClient` was invoked exactly once. Proves a second agent using the same provider doesn't redundantly reconstruct (or re-auth) a client.
  3. **Default fallback**: call the router with no `metadata.provider` at all (the shape every request from an agent with no declared `model.provider` override takes, and — before this feature — every request in the codebase); assert it resolves to `config.provider ?? DEFAULT_CLI_CONFIG.provider`. This is the path every existing single-provider session relies on; a regression here would be silent (still "answers", just from the wrong or a crashing provider) and would only surface in production use, not in an obviously-failing test.
- An end-to-end test in `cli.test.ts`: register two `CliModelProvider` test doubles via `ConsoleRuntimeFactoryOverrides.modelProviders`, load two agent fixtures each declaring a different provider, run both through the same `ConsoleSession`, and assert each run actually reached *its own* provider's client (not just that both runs returned `success`). This is the test that proves the headline claim of §8 — "a specific agent can use one model or the other according to the agent definition" — end to end, not just at the unit level.

### Caveats to accept explicitly (not silently)

- **This is a real, intentional breaking type change**: `CliConfig.provider`/`.model` go from required `string` to optional. Downstream call sites that assumed a defined string need a one-line update to fall back to `DEFAULT_CLI_CONFIG` where they truly need a concrete value for display/validation purposes, not routing:
  - `ConsoleSession.getStatus()` ([ConsoleSession.ts:82-83](../src/cli/ConsoleSession.ts#L82-L83)) — shows `this.config.provider`/`.model`, which can now legitimately be `undefined` before an agent has been loaded (the *effective* provider for the next prompt depends on which agent runs). Simplest fix: label it as the session-level override (`providerOverride: this.config.provider`) and leave discovering an agent's actual model to `/models`/`/agents`, rather than pretending `/status` can show one true global model.
  - `ConsoleApp.start()`'s startup banner ([ConsoleApp.ts:51-58](../src/cli/ConsoleApp.ts#L51-L58)) prints `provider: this.session.config.provider, model: this.session.config.model` directly — today this always shows the real default (`openai`/`gpt-5.4-mini`); after this change it would print `undefined`/`undefined` for the common case where the user set neither flag. Fix with the same `?? DEFAULT_CLI_CONFIG.provider` / `?? DEFAULT_CLI_CONFIG.model` fallback used elsewhere, labeled clearly (e.g. "provider (default): openai") so it doesn't imply that's necessarily what every agent in the session will use.
  - `mockProvider().createClient()` ([CliModelProvider.ts:26-33](../src/cli/CliModelProvider.ts#L26-L33)) reads `config.model` cosmetically for its canned response text — needs `config.model ?? DEFAULT_CLI_CONFIG.model`.
  - `ConsoleRuntimeFactory.diagnose()` ([ConsoleRuntimeFactory.ts:77-89](../src/cli/ConsoleRuntimeFactory.ts#L77-L89)) still validates a single provider (`config.provider ?? DEFAULT_CLI_CONFIG.provider`) since `doctor` runs without necessarily loading a specific agent's declared model — it validates "the provider you'd get by default," not every provider every agent might declare. Validating an agent's specific declared provider when `--agent` is passed to `doctor` is a reasonable follow-up, not included here.
  - Existing tests referencing `config.provider`/`config.model` as plain strings (`cli.test.ts` and friends) will need equivalent small adjustments.
- Package version is `0.1.0` (pre-1.0), so a type-shape change like this is acceptable, but it's called out here so it isn't discovered mid-implementation.

## 9. Multi-model registry & `/models` console command

### Requirement

Beyond picking *a* provider, users need to see which **models** are available and be able to register more than one model per provider without touching code. `/models` should behave like the existing read-only console commands (`/tools`, `/agents`, `/skills` in [defaultCommands.ts](../src/cli/commands/defaultCommands.ts#L109-L150)) — same shape, same `session.runtime` access pattern.

### Design

Add a `ModelDescriptor` type and a `listModels()` method to the existing `CliModelProvider` contract. This is additive to an interface every provider already implements (mock/openai/nvidia all gain an implementation in this same change), so it doesn't compromise Liskov substitution:

```ts
// src/cli/CliModelProvider.ts
export interface ModelDescriptor {
  readonly id: string;          // value passed as LLMRequest.model / --model
  readonly label?: string;
  readonly description?: string;
}

export interface CliModelProvider {
  readonly name: string;
  createClient(config: CliConfig, env?: NodeJS.ProcessEnv): Promise<LLMClient>;
  validateConfig(config: CliConfig, env?: NodeJS.ProcessEnv): readonly CliDiagnostic[];
  listModels(env?: NodeJS.ProcessEnv): readonly ModelDescriptor[];   // NEW
}
```

`listModels` is deliberately synchronous, static, and needs no API key or network call — `/models` must work even for a provider that isn't currently selected, purely to show what's available and how to select it.

Each provider owns its own catalog **and** its own env-var-based extension point, so registering more models never touches a shared file:

```ts
function openAIProvider(): CliModelProvider {
  return {
    name: 'openai',
    // ...createClient/validateConfig unchanged from today...
    listModels(env = process.env) {
      return parseModelList(env.OPENAI_MODELS) ?? [
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Default — fast, low cost.' },
        { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Higher-capability variant.' },
      ];
    },
  };
}

function nvidiaProvider(): CliModelProvider {
  return {
    name: 'nvidia',
    // ...createClient/validateConfig from §5...
    listModels(env = process.env) {
      return parseModelList(env.NVIDIA_MODELS) ?? [
        { id: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
        { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct' },
        { id: 'nvidia/nemotron-4-340b-instruct', label: 'Nemotron-4 340B Instruct' },
      ];
    },
  };
}

function parseModelList(raw: string | undefined): readonly ModelDescriptor[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw.split(',').map((id) => id.trim()).filter(Boolean).map((id) => ({ id }));
}
```

The curated defaults above are a starting point, not a ceiling: setting `OPENAI_MODELS=gpt-5.4,gpt-5.4-mini,o5-pro` or `NVIDIA_MODELS=meta/llama-3.1-8b-instruct,...` in `.env` immediately changes what `/models` reports and what's valid to pass to `--model`, with **zero code changes**. `mockProvider()` also gets a trivial `listModels()` (e.g. `[{ id: 'mock-echo', label: 'Mock Echo' }]`) so no provider is exempt from the interface.

### Wiring into the console

`ConsoleRuntime` currently exposes `toolRegistry`, `agentProvider`, etc. but not the resolved provider list ([ConsoleRuntimeFactory.ts:19-27](../src/cli/ConsoleRuntimeFactory.ts#L19-L27)). Add one field, populated from the same `providers` array `createRuntime` already builds at [line 44](../src/cli/ConsoleRuntimeFactory.ts#L44):

```ts
export interface ConsoleRuntime {
  // ...existing fields...
  readonly modelProviders: readonly CliModelProvider[];
}
```

```ts
// inside createRuntime(), reusing the existing `providers` local:
return { ...existingFields, modelProviders: providers };
```

New command, following the exact shape of `toolsCommand()` / `agentsCommand()`:

```ts
function modelsCommand(): ConsoleCommand {
  return {
    name: 'models',
    description: 'List registered models across all configured providers.',
    usage: '/models',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      await session.initialize();
      const providers = session.runtime?.modelProviders ?? [];
      return {
        status: 'success',
        data: providers.map((provider) => ({
          provider: provider.name,
          active: provider.name === (session.config.provider ?? DEFAULT_CLI_CONFIG.provider),
          models: provider.listModels().map((model) => ({
            ...model,
            active: provider.name === (session.config.provider ?? DEFAULT_CLI_CONFIG.provider)
              && model.id === (session.config.model ?? DEFAULT_CLI_CONFIG.model),
          })),
        })),
      };
    },
  };
}
```

Note `active` here reflects the session-level default from §8's precedence chain (explicit flag, else global default) — since an agent can declare its own `model.provider` (§8), the model that's actually `active` for the *next* prompt can differ per agent. `/agents` already lists agent ids; a later pass could annotate each with its declared model, but `/models` staying provider/catalog-focused (not agent-cross-referencing) keeps this command's one job single-purpose.

Register it in `createDefaultCommandRegistry()`'s `commands` array ([defaultCommands.ts:7-20](../src/cli/commands/defaultCommands.ts#L7-L20)), alongside `toolsCommand()`/`agentsCommand()`/`skillsCommand()`.

### Other touch points

- `src/index.ts`: export `ModelDescriptor` alongside the `CliModelProvider` export already planned in §5.
- `.env.example`: document `OPENAI_MODELS=` and `NVIDIA_MODELS=` as optional comma-separated overrides, next to the corresponding `*_API_KEY` lines.

### SOLID check

- **OCP** still holds end-to-end: registering more models is a config change (`OPENAI_MODELS` / `NVIDIA_MODELS`), not a code change; a future provider #3 ships its own `listModels()` — `/models` and `ConsoleRuntimeFactory` need no changes when it's added.
- **LSP**: every `CliModelProvider` implements `listModels()` identically in shape (sync, optional `env` arg) — `/models` never special-cases a provider.
- **ISP**: `listModels()` is added to the interface that already models "a provider's capabilities" (`CliModelProvider`), rather than bolted onto the unrelated `LLMClient` transport contract.

### Testing

- `listModels()` test per provider: `mockProvider().listModels()` returns its one static entry; `openAIProvider().listModels()` with no env override returns the curated default list; with `OPENAI_MODELS=a,b,c` set, returns `[{id:'a'},{id:'b'},{id:'c'}]` instead — same shape for `nvidiaProvider()` / `NVIDIA_MODELS`. Also covers `parseModelList()`'s trimming/empty-filtering directly (`" a, ,b "` → `[{id:'a'},{id:'b'}]`, empty/whitespace-only string → `undefined` so the curated default still applies).
- `modelsCommand` test: register two `CliModelProvider` test doubles via the `modelProviders` override (same pattern used for `toolsCommand`/`agentsCommand` tests), invoke `/models`, and assert: one entry per provider; each provider's `models` array reflects either its curated default or an env override; the `active` flag is `true` only for the session's resolved provider/model, including the `?? DEFAULT_CLI_CONFIG` fallback path when neither is explicitly set (the common case, and the one most likely to silently break if the optional-`CliConfig` change from §8 is applied carelessly here).

### Explicitly not included here

Switching the *active* model/provider mid-session (e.g. a hypothetical `/model use <id>` mutating `session.config`) is a separate, larger change — `CliConfig` is currently treated as immutable for the life of a `ConsoleSession` ([ConsoleSession.ts:21-27](../src/cli/ConsoleSession.ts#L21-L27)), and `loadAgent()` re-derives `model`/`provider` from it on every `submitPrompt` call. `/models` here is read-only, matching what was asked for; live switching is a reasonable follow-up but roughly doubles this section's surface area (mutable config, re-validation on change) and isn't required to satisfy "show list of models registered."

## 10. Explicitly out of scope for this change

- **Real token streaming.** Both `OpenAIClient` and the new NVIDIA client will keep the existing "wrap `call()` as a single `'complete'` stream event" shim already used for OpenAI ([OpenAIClient.ts:56-62](../src/models/OpenAIClient.ts#L56-L62)). True SSE streaming is a larger, separate change flagged in [docs/agentic-runtime-gap-analysis.md](agentic-runtime-gap-analysis.md) and isn't required to satisfy "switch providers at will."
- **Automatic cross-provider fallback/load-balancing** (e.g. silently retrying an NVIDIA-declared agent against OpenAI on error). §8 adds *static, declared* per-agent routing only — which provider a call uses is always explicit (flag, agent frontmatter, or default), never decided dynamically at request time. The primitives for dynamic fallback (`createFallbackLLMClient`, `createRetryingLLMClient`) already exist and are exported; composing them into the router's `resolve()` is a reasonable follow-up, not required here.
- **NVIDIA model catalog validation** (verifying `--model` or an agent's `model.model` is a real NIM model id). Left as free-text, consistent with how the OpenAI provider behaves today.
- **Live provider/model switching mid-session** via a command (e.g. `/model use <id>`) — noted already at the end of §9.
- **`doctor` validating an agent's specific declared provider** — it validates the default/explicit provider only (§8 caveats); extending it to also check whatever `--agent` declares is a small, separate follow-up.

## 11. Implementation order

1. `src/models/OpenAICompatibleChatClient.ts` (generic, unit-tested standalone).
2. `src/models/NvidiaClient.ts` (thin wrapper over #1).
3. `src/cli/CliModelProvider.ts`: add `ModelDescriptor`, `listModels()` on the interface, `nvidiaProvider()` + `listModels()` on mock/openai/nvidia, register in `createDefaultModelProviders()`.
4. `src/cli/CliConfig.ts`: make `provider`/`model` optional (explicit-only), add `MELA_RUNTIME_MODEL` fallback ahead of the legacy `OPENAI_MODEL`.
5. `src/definitions/AgentDefinitionLoader.ts` + `DefinitionSchemas.ts`: parse/validate the optional `model:` frontmatter block instead of hardcoding it.
6. `src/models/LLMClient.ts`: add `LLMClientResolver` + `createRoutingLLMClient`. New `src/cli/ModelClientRouter.ts`: add `createCliModelClientRouter`.
7. `src/cli/ConsoleRuntimeFactory.ts`: build the client via the router; fix `loadAgent()` precedence (explicit > agent > default); add `modelProviders` to `ConsoleRuntime`; adjust `diagnose()`/`mockProvider()` for the now-optional `config.provider`/`.model` (§8 caveats).
8. `src/runtime/ConversationEngine.ts`: add `metadata: { provider: agent.model.provider }` to the outgoing request — the one engine-level change.
9. `src/cli/commands/defaultCommands.ts`: add `modelsCommand()`, register it.
10. `src/index.ts`: add all exports from §5, §8, §9 (`CliModelProvider`, `ModelDescriptor`, `createDefaultModelProviders`, `resolveModelProvider`, `createRoutingLLMClient`, `createCliModelClientRouter`, `createNvidiaClient`, `createOpenAICompatibleChatClient`, plus their config types).
11. `.env.example` + `src/cli/CliArgs.ts` help text (`OPENAI_MODELS`, `NVIDIA_MODELS`, provider list string).
12. Tests: §6's provider/client tests, §8's "Testing" subsection (frontmatter parsing, `validateAgentFrontmatter`, `loadAgent()` precedence, the three `createCliModelClientRouter`/`createRoutingLLMClient` tests, and the end-to-end two-providers-in-one-session test), §9's "Testing" subsection (`listModels()` per provider incl. env override, `modelsCommand`), plus updates to existing tests touched by the `CliConfig.provider`/`.model` type change (§8 caveats). Confirmed via `src/__tests__/conversation-engine.test.ts` that no existing test asserts the exact shape of the request passed to `llmClient.call()`, so adding `metadata: { provider }` there does not require touching that file.
13. `yarn build && yarn test` to confirm no regressions; manual `yarn doctor --provider nvidia` smoke check with a real `NVIDIA_API_KEY` set locally (not committed); manual console smoke test: one agent with `model.provider: nvidia` in frontmatter, run it in the same session as the (OpenAI) default agent, confirm both work without a `--provider` flag.

Steps 1-3 (NVIDIA client + registry) and 9-11 (models command, exports, docs) are independently shippable. Steps 4-8 (per-agent routing) are one coherent unit — §8 explains why they can't be split further without leaving the feature half-working.
