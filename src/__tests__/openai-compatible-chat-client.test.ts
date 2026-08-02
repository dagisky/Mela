import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleChatClient } from '../models/OpenAICompatibleChatClient.js';
import type { LLMRequest } from '../models/LLMClient.js';

function request(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'some-model',
    messages: [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'hi' },
    ],
    maxTokens: 10,
    temperature: 0.2,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('OpenAI-compatible chat-completions client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to {baseUrl}/chat/completions with a messages array and tool schema', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAICompatibleChatClient({ apiKey: 'test-key', baseUrl: 'https://example.test/v1', provider: 'test-provider' });
    const response = await client.call(request({
      tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');

    const body = JSON.parse(String(init.body)) as {
      messages: readonly { role: string; content: string }[];
      tools: readonly { type: string; function: { name: string; parameters: Record<string, unknown> } }[];
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
    });

    expect(response.content).toBe('ok');
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(response.model).toBe('some-model');
  });

  it('maps choices[0].message.tool_calls into ToolCallRequest[]', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'echo', arguments: '{"value":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAICompatibleChatClient({ apiKey: 'k', baseUrl: 'https://example.test/v1', provider: 'test-provider' });
    const response = await client.call(request());

    expect(response.toolCalls).toEqual([{ id: 'call_1', name: 'echo', arguments: '{"value":1}' }]);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('throws a clear error on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400, statusText: 'Bad Request' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAICompatibleChatClient({ apiKey: 'k', baseUrl: 'https://example.test/v1', provider: 'test-provider' });

    await expect(client.call(request())).rejects.toThrow(/test-provider request failed with 400/);
  });

  it('sets metadata.provider from config', () => {
    const client = createOpenAICompatibleChatClient({ apiKey: 'k', baseUrl: 'https://example.test/v1', provider: 'nvidia' });
    expect(client.metadata).toMatchObject({ provider: 'nvidia', supportsTools: true });
  });
});
