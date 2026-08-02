import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleCommandRegistry,
  ConsoleSession,
  ConsoleRuntimeFactory,
  AgentDefinitionLoader,
  SkillDefinitionLoader,
  createCliConfig,
  DEFAULT_CLI_CONFIG,
  loadDotEnv,
  LocalToolModuleProvider,
  type CliModelProvider,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  parseCliArgs,
  parseConsoleInput,
  runChatCommand,
  runDoctorCommand,
  SilentRenderer,
} from '../index.js';
import { createDefaultCommandRegistry } from '../cli/commands/defaultCommands.js';

describe('CLI primitives', () => {
  it('parses chat args with provider and output mode', () => {
    expect(parseCliArgs(['--provider', 'mock', '--json', 'hello', 'runtime'])).toMatchObject({
      provider: 'mock',
      outputMode: 'json',
      prompt: 'hello runtime',
    });
  });

  it('parses console slash commands', () => {
    expect(parseConsoleInput('/status')).toEqual({
      type: 'command',
      command: { name: 'status', args: [], raw: '/status' },
    });
    expect(parseConsoleInput('hello')).toEqual({ type: 'prompt', text: 'hello' });
  });

  it('loads dotenv values without overriding existing env', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mela-cli-env-'));
    const envPath = path.join(dir, '.env');
    await writeFile(envPath, 'OPENAI_MODEL="from-file"\nEXISTING=from-file\n# comment\n', 'utf8');
    const env: NodeJS.ProcessEnv = { EXISTING: 'kept' };

    const result = await loadDotEnv(envPath, env);

    expect(result.loaded).toBe(true);
    expect(env.OPENAI_MODEL).toBe('from-file');
    expect(env.EXISTING).toBe('kept');
  });

  it('resolves command aliases', () => {
    const command = {
      name: 'status',
      aliases: ['s'],
      description: 'status',
      usage: '/status',
      async execute() {
        return { status: 'success' as const };
      },
    };
    const registry = new ConsoleCommandRegistry([command]);
    expect(registry.resolve('s')).toBe(command);
  });

  it('loads human-readable markdown agent and skill definitions', () => {
    const agent = new AgentDefinitionLoader().loadMarkdown(`---
id: default
name: Default
skills:
  - gather-context
tools:
  allow:
    - repo_search
  deny: []
---

# Role

You are helpful.
`);
    const skill = new SkillDefinitionLoader().loadMarkdown(`---
id: gather-context
name: Gather Context
---

# Instructions

Gather context.
`);

    expect(agent).toMatchObject({
      id: 'default',
      name: 'Default',
      tools: ['repo_search'],
      systemPrompt: 'You are helpful.',
    });
    expect(skill).toMatchObject({
      id: 'gather-context',
      name: 'Gather Context',
      body: { instructions: 'Gather context.' },
    });
  });

  it('parses an agent-declared model block from frontmatter', () => {
    const agent = new AgentDefinitionLoader().loadMarkdown(`---
id: research-agent
name: Research Agent
model:
  provider: nvidia
  model: meta/llama-3.1-405b-instruct
  temperature: 0.1
---

# Role

You research things.
`);

    expect(agent.model).toEqual({
      provider: 'nvidia',
      model: 'meta/llama-3.1-405b-instruct',
      maxTokens: 2048,
      temperature: 0.1,
    });
  });

  it('falls back to the hardcoded model defaults when no model: frontmatter is present', () => {
    const agent = new AgentDefinitionLoader().loadMarkdown(`---
id: default
name: Default
---

# Role

You are helpful.
`);

    expect(agent.model).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      maxTokens: 2048,
      temperature: 0.2,
    });
  });

  it('rejects a model: frontmatter field with the wrong shape', () => {
    expect(() => new AgentDefinitionLoader().loadMarkdown(`---
id: bad
name: Bad
model:
  temperature: "hot"
---

# Role

Body.
`)).toThrow(/model\.temperature must be a number/);
  });

  it('loads external TypeScript tool modules', async () => {
    const cwd = await createTempRuntimeProject();
    const provider = new LocalToolModuleProvider(path.join(cwd, 'tools'));
    const tools = await provider.loadAll();
    const tool = tools[0]!;
    const validation = tool.validateInput({ text: 'hello' });
    const result = validation.ok
      ? await tool.execute(validation.value, {
        runContext: {
          runId: 'run_1',
          sessionId: 'session_1',
          correlationId: 'corr_1',
          agentId: 'default',
          definitionVersions: {},
          toolNames: ['echo'],
          budgets: { maxTurns: 1, maxToolCalls: 1, maxContextTokens: 1000 },
          signal: new AbortController().signal,
          metadata: {},
        },
      })
      : undefined;

    expect(tool).toMatchObject({
      name: 'echo',
      description: 'Echo local inputs for tests.',
      timeoutMs: 5000,
    });
    expect(validation.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      output: { ok: true, message: 'wired' },
    });
  });
});

describe('CLI runtime', () => {
  it('runs one-shot chat with mock provider', async () => {
    const cwd = await createTempRuntimeProject();
    const renderer = new SilentRenderer();
    const config = createCliConfig({
      cwd,
      provider: 'mock',
      model: 'mock-model',
      prompt: 'hello',
      storagePath: '.runtime',
    });

    const exitCode = await runChatCommand(config, renderer, new ConsoleRuntimeFactory());

    expect(exitCode).toBe(0);
    expect(renderer.terminalResults[0]).toMatchObject({
      status: 'success',
      message: 'Mock response from default: hello',
    });
  });

  it('returns doctor diagnostics for mock provider and default agent', async () => {
    const cwd = await createTempRuntimeProject();
    const config = createCliConfig({ cwd, provider: 'mock' });

    const diagnostics = await runDoctorCommand(config, new ConsoleRuntimeFactory());

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'mock_provider')).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'agent_loaded')).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'tool_modules_loaded')).toBe(true);
  });

  it('carries prior CLI turns into follow-up prompts', async () => {
    const cwd = await createTempRuntimeProject();
    const observed: unknown[][] = [];
    let callIndex = 0;
    const responses: LLMResponse[] = [
      { content: 'Thermodynamics studies heat and energy.', toolCalls: [], finishReason: 'stop' as const, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock-model' },
      { content: 'Again: thermodynamics studies heat and energy.', toolCalls: [], finishReason: 'stop' as const, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock-model' },
    ];
    const observingClient: LLMClient = {
      metadata: { provider: 'mock', supportsStreaming: true, supportsTools: true },
      async call(request: LLMRequest) {
        observed.push(request.messages.map((message) => message.content));
        return responses[callIndex++]!;
      },
      async *stream() {},
    };
    const config = createCliConfig({ cwd, provider: 'mock', model: 'mock-model' });
    const session = new ConsoleSession(
      config,
      new ConsoleRuntimeFactory({ modelClient: observingClient }),
      new SilentRenderer(),
    );

    await session.submitPrompt('tell me about thermodynamics');
    await session.submitPrompt('explain that again?');

    expect(observed[1]).toEqual([
      'You are helpful.',
      'tell me about thermodynamics',
      'Thermodynamics studies heat and energy.',
      'explain that again?',
    ]);
  });
});

describe('per-agent model/provider precedence', () => {
  // Points loadDotEnv() at a file that doesn't exist, so these tests are never affected by
  // whatever the developer's real repo-root .env happens to contain (e.g. MELA_RUNTIME_PROVIDER).
  function isolatedEnvPath(cwd: string): string {
    return path.join(cwd, '.env');
  }

  it('an agent-declared provider wins when no CLI flag is set', async () => {
    const cwd = await createTempRuntimeProject();
    const factory = new ConsoleRuntimeFactory();
    const config = createCliConfig({ cwd, agentId: 'nvidia-agent', envPath: isolatedEnvPath(cwd) }, {});
    const runtime = await factory.createRuntime(config);

    const agent = await factory.loadAgent(config, runtime);

    expect(agent.model.provider).toBe('nvidia');
    expect(agent.model.model).toBe('meta/llama-3.1-405b-instruct');
  });

  it('an explicit CLI flag overrides the agent-declared provider', async () => {
    const cwd = await createTempRuntimeProject();
    const factory = new ConsoleRuntimeFactory();
    const config = createCliConfig(
      { cwd, agentId: 'nvidia-agent', provider: 'openai', model: 'gpt-5.4', envPath: isolatedEnvPath(cwd) },
      {},
    );
    const runtime = await factory.createRuntime(config);

    const agent = await factory.loadAgent(config, runtime);

    expect(agent.model.provider).toBe('openai');
    expect(agent.model.model).toBe('gpt-5.4');
  });

  it('falls back to the global default when neither the flag nor the agent declares a provider', async () => {
    const cwd = await createTempRuntimeProject();
    const factory = new ConsoleRuntimeFactory();
    const config = createCliConfig({ cwd, agentId: 'default', envPath: isolatedEnvPath(cwd) }, {});
    const runtime = await factory.createRuntime(config);

    const agent = await factory.loadAgent(config, runtime);

    expect(agent.model.provider).toBe(DEFAULT_CLI_CONFIG.provider);
    expect(agent.model.model).toBe(DEFAULT_CLI_CONFIG.model);
  });

  it("falls back to the resolved provider's own first registered model (its *_MODELS env list) before the hardcoded default", async () => {
    vi.stubEnv('NVIDIA_MODELS', 'deepseek-ai/deepseek-v4-pro,meta/llama-3.1-70b-instruct');
    try {
      const cwd = await createTempRuntimeProject();
      const factory = new ConsoleRuntimeFactory();
      const config = createCliConfig({ cwd, agentId: 'default', provider: 'nvidia', envPath: isolatedEnvPath(cwd) }, {});
      const runtime = await factory.createRuntime(config);

      const agent = await factory.loadAgent(config, runtime);

      expect(agent.model.provider).toBe('nvidia');
      expect(agent.model.model).toBe('deepseek-ai/deepseek-v4-pro');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('routes two agents through the same runtime to their own declared provider', async () => {
    const cwd = await createTempRuntimeProject();
    const openaiCalls: string[] = [];
    const nvidiaCalls: string[] = [];
    const modelProviders: CliModelProvider[] = [
      {
        name: 'openai',
        async createClient() {
          return {
            metadata: { provider: 'openai', supportsStreaming: true, supportsTools: true },
            async call(request: LLMRequest) {
              openaiCalls.push(request.model);
              return {
                content: 'openai response', toolCalls: [], finishReason: 'stop' as const,
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: request.model,
              };
            },
            async *stream() {},
          };
        },
        validateConfig: () => [],
        listModels: () => [],
      },
      {
        name: 'nvidia',
        async createClient() {
          return {
            metadata: { provider: 'nvidia', supportsStreaming: true, supportsTools: true },
            async call(request: LLMRequest) {
              nvidiaCalls.push(request.model);
              return {
                content: 'nvidia response', toolCalls: [], finishReason: 'stop' as const,
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: request.model,
              };
            },
            async *stream() {},
          };
        },
        validateConfig: () => [],
        listModels: () => [],
      },
    ];
    const factory = new ConsoleRuntimeFactory({ modelProviders });
    const config = createCliConfig({ cwd, envPath: isolatedEnvPath(cwd) }, {});
    const runtime = await factory.createRuntime(config);

    const defaultAgent = await factory.loadAgent({ ...config, agentId: 'default' }, runtime);
    const nvidiaAgent = await factory.loadAgent({ ...config, agentId: 'nvidia-agent' }, runtime);

    const defaultResult = await runtime.conversationEngine.submit({
      agentDefinition: defaultAgent,
      userMessage: 'hello',
    });
    const nvidiaResult = await runtime.conversationEngine.submit({
      agentDefinition: nvidiaAgent,
      userMessage: 'hello',
    });

    expect(defaultResult.message).toBe('openai response');
    expect(openaiCalls).toEqual(['gpt-5.4-mini']);
    expect(nvidiaResult.message).toBe('nvidia response');
    expect(nvidiaCalls).toEqual(['meta/llama-3.1-405b-instruct']);
  });
});

describe('/models command', () => {
  it('lists registered models per provider with the active flags set', async () => {
    const cwd = await createTempRuntimeProject();
    const modelProviders: CliModelProvider[] = [
      {
        name: 'alpha',
        async createClient(): Promise<LLMClient> { throw new Error('not used in this test'); },
        validateConfig: () => [],
        listModels: () => [{ id: 'a1' }, { id: 'a2', label: 'Alpha Two' }],
      },
      {
        name: 'beta',
        async createClient(): Promise<LLMClient> { throw new Error('not used in this test'); },
        validateConfig: () => [],
        listModels: () => [{ id: 'b1' }],
      },
    ];
    const config = createCliConfig({ cwd, provider: 'alpha', model: 'a2', envPath: path.join(cwd, '.env') }, {});
    const session = new ConsoleSession(config, new ConsoleRuntimeFactory({ modelProviders }), new SilentRenderer());
    const command = createDefaultCommandRegistry().resolve('models')!;

    const result = await command.execute({ name: 'models', args: [], raw: '/models' }, session);

    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}`);
    expect(result.data).toEqual([
      {
        provider: 'alpha',
        active: true,
        models: [
          { id: 'a1', active: false },
          { id: 'a2', label: 'Alpha Two', active: true },
        ],
      },
      { provider: 'beta', active: false, models: [{ id: 'b1', active: false }] },
    ]);
  });

  it('falls back to DEFAULT_CLI_CONFIG when no provider/model is explicitly set', async () => {
    const cwd = await createTempRuntimeProject();
    const modelProviders: CliModelProvider[] = [{
      name: DEFAULT_CLI_CONFIG.provider,
      async createClient(): Promise<LLMClient> { throw new Error('not used in this test'); },
      validateConfig: () => [],
      listModels: () => [{ id: DEFAULT_CLI_CONFIG.model }],
    }];
    const config = createCliConfig({ cwd, envPath: path.join(cwd, '.env') }, {});
    const session = new ConsoleSession(config, new ConsoleRuntimeFactory({ modelProviders }), new SilentRenderer());
    const command = createDefaultCommandRegistry().resolve('models')!;

    const result = await command.execute({ name: 'models', args: [], raw: '/models' }, session);

    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}`);
    expect(result.data).toEqual([
      { provider: DEFAULT_CLI_CONFIG.provider, active: true, models: [{ id: DEFAULT_CLI_CONFIG.model, active: true }] },
    ]);
  });
});

async function createTempRuntimeProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'mela-cli-runtime-'));
  await mkdir(path.join(cwd, 'agents'), { recursive: true });
  await mkdir(path.join(cwd, 'skills'), { recursive: true });
  await mkdir(path.join(cwd, 'tools'), { recursive: true });
  await writeFile(path.join(cwd, 'agents', 'default.md'), `---
id: default
name: Default
version: 1.0.0
skills:
  - gather-context
tools:
  allow:
    - echo
  deny: []
---

# Role

You are helpful.
`, 'utf8');
  await writeFile(path.join(cwd, 'agents', 'nvidia-agent.md'), `---
id: nvidia-agent
name: NVIDIA Agent
version: 1.0.0
model:
  provider: nvidia
  model: meta/llama-3.1-405b-instruct
tools:
  allow:
    - echo
  deny: []
---

# Role

You are an NVIDIA-backed agent.
`, 'utf8');
  await writeFile(path.join(cwd, 'skills', 'gather-context.md'), `---
id: gather-context
name: Gather Context
---

# Instructions

Gather context.
`, 'utf8');
  await writeFile(path.join(cwd, 'tools', 'echo.ts'), `const echoTool = {
  name: 'echo',
  description: 'Echo local inputs for tests.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    additionalProperties: true,
  },
  timeoutMs: 5000,
  concurrencySafe: true,
  validateInput(input: unknown) {
    if (!input || typeof input !== 'object') return { ok: false, message: 'Tool input must be an object.' };
    return { ok: true, value: input as Record<string, unknown> };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute() {
    return { ok: true as const, output: { ok: true, message: 'wired' } };
  },
  mapResultToModel(result: { ok: boolean; output?: unknown; message?: string }, toolCallId: string) {
    return {
      toolCallId,
      content: JSON.stringify(result.ok ? { ok: true, output: result.output } : { ok: false, message: result.message }),
      isError: !result.ok,
    };
  },
};

export default echoTool;
`, 'utf8');
  return cwd;
}
