import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectStreamResponse,
  createFallbackLLMClient,
  createMockLLMClient,
  createRetryingLLMClient,
  type LLMClient,
  type LLMResponse,
} from '../models/LLMClient.js';
import { createOpenAIClient } from '../models/OpenAIClient.js';

const response: LLMResponse = {
  content: 'ok',
  toolCalls: [],
  finishReason: 'stop',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  model: 'test',
};

function request(signal = new AbortController().signal) {
  return { model: 'test', messages: [], maxTokens: 10, temperature: 0, signal };
}

describe('LLM client helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries transient call failures', async () => {
    let attempts = 0;
    const flaky: LLMClient = {
      async call() {
        attempts++;
        if (attempts === 1) throw new Error('transient');
        return response;
      },
      async *stream() {
        yield { type: 'complete', response };
      },
    };

    const client = createRetryingLLMClient(flaky, { maxAttempts: 2, baseDelayMs: 1 });

    await expect(client.call(request())).resolves.toEqual(response);
    expect(attempts).toBe(2);
  });

  it('falls back across providers', async () => {
    const failing: LLMClient = {
      metadata: { provider: 'bad', supportsStreaming: true, supportsTools: true },
      call: async () => { throw new Error('bad provider'); },
      stream: async function* () { yield { type: 'error', error: new Error('bad provider') }; },
    };
    const fallback = createFallbackLLMClient([failing, createMockLLMClient([response])]);

    await expect(fallback.call(request())).resolves.toEqual(response);
    expect(fallback.metadata?.provider).toBe('bad+mock');
  });

  it('collects streaming deltas into a response', async () => {
    const client: LLMClient = {
      async call() {
        return response;
      },
      async *stream() {
        yield { type: 'token', token: 'he' };
        yield { type: 'token', token: 'llo' };
      },
    };

    await expect(collectStreamResponse(client, request())).resolves.toMatchObject({
      content: 'hello',
      finishReason: 'stop',
    });
  });

  it('normalizes bare object tool schemas for OpenAI function parameters', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output_text: 'ok',
      output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createOpenAIClient({ apiKey: 'test-key' });

    await client.call({
      ...request(),
      tools: [{
        name: 'echo',
        description: 'Echo',
        parameters: { type: 'object' },
      }],
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1].body)) as {
      tools: readonly { parameters: Record<string, unknown> }[];
    };
    expect(body.tools[0]?.parameters).toEqual({ type: 'object', properties: {} });
  });
});
