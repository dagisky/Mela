import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNvidiaClient } from '../models/NvidiaClient.js';

describe('NVIDIA client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults baseUrl to https://integrate.api.nvidia.com/v1 and sets metadata.provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createNvidiaClient({ apiKey: 'test-key' });
    expect(client.metadata?.provider).toBe('nvidia');

    await client.call({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      temperature: 0.2,
      signal: new AbortController().signal,
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
  });

  it('respects an explicit baseUrl override', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createNvidiaClient({ apiKey: 'test-key', baseUrl: 'https://custom.example/v1' });
    await client.call({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 10,
      temperature: 0.2,
      signal: new AbortController().signal,
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://custom.example/v1/chat/completions');
  });
});
