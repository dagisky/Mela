import { describe, expect, it, vi } from 'vitest';
import { createRoutingLLMClient, type LLMClient, type LLMResponse } from '../models/LLMClient.js';
import { createCliModelClientRouter } from '../cli/ModelClientRouter.js';
import { DEFAULT_CLI_CONFIG, type CliConfig } from '../cli/CliConfig.js';
import type { CliModelProvider } from '../cli/CliModelProvider.js';

function baseConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    agentId: 'default',
    storagePath: '.runtime',
    cwd: process.cwd(),
    envPath: '.env',
    toolsPath: 'tools',
    outputMode: 'text',
    debug: false,
    noColor: false,
    ...overrides,
  };
}

function response(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'test',
  };
}

function fakeProvider(name: string, createClient = vi.fn(async (): Promise<LLMClient> => ({
  metadata: { provider: name, supportsStreaming: true, supportsTools: true },
  call: vi.fn(async () => response(`from-${name}`)),
  async *stream() {},
}))): CliModelProvider {
  return {
    name,
    createClient,
    validateConfig: () => [],
    listModels: () => [],
  };
}

function request(providerHint?: string) {
  return {
    model: 'test',
    messages: [],
    maxTokens: 10,
    temperature: 0,
    signal: new AbortController().signal,
    metadata: providerHint === undefined ? undefined : { provider: providerHint },
  };
}

describe('createCliModelClientRouter / createRoutingLLMClient', () => {
  it('dispatches each call to the client matching request.metadata.provider', async () => {
    const fast = fakeProvider('fast-fake');
    const slow = fakeProvider('slow-fake');
    const router = createCliModelClientRouter([fast, slow], baseConfig());
    const client = createRoutingLLMClient(router);

    const fastResponse = await client.call(request('fast-fake'));
    const slowResponse = await client.call(request('slow-fake'));

    expect(fastResponse.content).toBe('from-fast-fake');
    expect(slowResponse.content).toBe('from-slow-fake');
  });

  it('caches one client per provider name instead of reconstructing it on every call', async () => {
    const createClient = vi.fn(async (): Promise<LLMClient> => ({
      metadata: { provider: 'cached-fake', supportsStreaming: true, supportsTools: true },
      call: async () => response('ok'),
      async *stream() {},
    }));
    const provider = fakeProvider('cached-fake', createClient);
    const router = createCliModelClientRouter([provider], baseConfig());
    const client = createRoutingLLMClient(router);

    await client.call(request('cached-fake'));
    await client.call(request('cached-fake'));
    await client.call(request('cached-fake'));

    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('does not construct a provider client until it is actually requested', async () => {
    const usedCreateClient = vi.fn(async (): Promise<LLMClient> => ({
      metadata: { provider: 'used', supportsStreaming: true, supportsTools: true },
      call: async () => response('ok'),
      async *stream() {},
    }));
    const unusedCreateClient = vi.fn(async (): Promise<LLMClient> => {
      throw new Error('should never be constructed');
    });
    const router = createCliModelClientRouter(
      [fakeProvider('used', usedCreateClient), fakeProvider('unused', unusedCreateClient)],
      baseConfig(),
    );
    const client = createRoutingLLMClient(router);

    await client.call(request('used'));

    expect(usedCreateClient).toHaveBeenCalledTimes(1);
    expect(unusedCreateClient).not.toHaveBeenCalled();
  });

  it('falls back to config.provider when the request carries no provider hint', async () => {
    const provider = fakeProvider('openai-like');
    const router = createCliModelClientRouter([provider], baseConfig({ provider: 'openai-like' }));
    const client = createRoutingLLMClient(router);

    const result = await client.call(request(undefined));

    expect(result.content).toBe('from-openai-like');
  });

  it('falls back to DEFAULT_CLI_CONFIG.provider when neither the request nor config declares a provider', async () => {
    const provider = fakeProvider(DEFAULT_CLI_CONFIG.provider);
    const router = createCliModelClientRouter([provider], baseConfig());
    const client = createRoutingLLMClient(router);

    const result = await client.call(request(undefined));

    expect(result.content).toBe(`from-${DEFAULT_CLI_CONFIG.provider}`);
  });
});
