import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConsoleCommandRegistry,
  ConsoleSession,
  ConsoleRuntimeFactory,
  AgentDefinitionLoader,
  SkillDefinitionLoader,
  createCliConfig,
  loadDotEnv,
  LocalToolModuleProvider,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  parseCliArgs,
  parseConsoleInput,
  runChatCommand,
  runDoctorCommand,
  SilentRenderer,
} from '../index.js';

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
    const dir = await mkdtemp(path.join(tmpdir(), 'ria-cli-env-'));
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

async function createTempRuntimeProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ria-cli-runtime-'));
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
