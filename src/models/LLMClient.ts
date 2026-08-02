import type { Logger } from '../types/index.js';

/** A single message in the LLM conversation. */
export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/** Request to the LLM. */
export interface LLMRequest {
  readonly model: string;
  readonly messages: readonly LLMMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  readonly tools?: readonly LLMToolSchema[];
  readonly responseFormat?: 'text' | 'json';
  readonly signal: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface LLMToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Response from the LLM. */
export interface LLMResponse {
  readonly content: string;
  readonly toolCalls: readonly ToolCallRequest[];
  readonly finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
  readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  readonly model: string;
}

/** Streaming event from the LLM. */
export type LLMStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'tool_call'; toolCall: ToolCallRequest }
  | { type: 'complete'; response: LLMResponse }
  | { type: 'error'; error: Error };

export interface LLMClientMetadata {
  readonly provider: string;
  readonly supportsStreaming: boolean;
  readonly supportsTools: boolean;
  readonly models?: readonly string[];
}

/** Provider-agnostic LLM client interface. */
export interface LLMClient {
  readonly metadata?: LLMClientMetadata;
  call(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncGenerator<LLMStreamEvent>;
}

export interface LLMRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  shouldRetry?(error: unknown, attempt: number): boolean;
}

/**
 * Create a mock LLM client for testing.
 * Returns predefined responses based on a response queue.
 */
export function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;

  return {
    metadata: {
      provider: 'mock',
      supportsStreaming: true,
      supportsTools: true,
    },

    async call(): Promise<LLMResponse> {
      if (callIndex >= responses.length) {
        throw new Error('Mock LLM client: no more responses in queue');
      }
      return responses[callIndex++]!;
    },

    async *stream(): AsyncGenerator<LLMStreamEvent> {
      if (callIndex >= responses.length) {
        yield { type: 'error', error: new Error('Mock LLM client: no more responses') };
        return;
      }
      yield { type: 'complete', response: responses[callIndex++]! };
    },
  };
}

export function createRetryingLLMClient(client: LLMClient, policy: LLMRetryPolicy, logger?: Logger): LLMClient {
  return {
    metadata: client.metadata,
    async call(request) {
      return retry(() => client.call(request), policy, request.signal, logger);
    },
    async *stream(request) {
      const response = await retry(() => collectStreamResponse(client, request), policy, request.signal, logger);
      yield { type: 'complete', response };
    },
  };
}

export function createFallbackLLMClient(clients: readonly LLMClient[], logger?: Logger): LLMClient {
  if (clients.length === 0) throw new Error('At least one LLM client is required.');
  return {
    metadata: {
      provider: clients.map((client) => client.metadata?.provider ?? 'unknown').join('+'),
      supportsStreaming: clients.some((client) => client.metadata?.supportsStreaming ?? true),
      supportsTools: clients.every((client) => client.metadata?.supportsTools ?? true),
    },
    async call(request) {
      const errors: string[] = [];
      for (const client of clients) {
        try {
          return await client.call(request);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          logger?.warn('LLM fallback client failed', { provider: client.metadata?.provider, error: errors[errors.length - 1] });
        }
      }
      throw new Error(`All LLM clients failed: ${errors.join('; ')}`);
    },
    async *stream(request) {
      const response = await this.call(request);
      yield { type: 'complete', response };
    },
  };
}

export interface LLMClientResolver {
  resolve(providerHint: string | undefined): Promise<LLMClient>;
}

/**
 * Composes an LLMClient that dispatches each call to a different underlying client
 * based on `request.metadata.provider`, via the supplied resolver. Lets a single
 * ConversationEngine serve agents that declare different model providers.
 */
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

export async function collectStreamResponse(client: LLMClient, request: LLMRequest): Promise<LLMResponse> {
  let content = '';
  const toolCalls: ToolCallRequest[] = [];
  let complete: LLMResponse | undefined;
  for await (const event of client.stream(request)) {
    if (event.type === 'token') content += event.token;
    if (event.type === 'tool_call') toolCalls.push(event.toolCall);
    if (event.type === 'complete') complete = event.response;
    if (event.type === 'error') throw event.error;
  }
  return complete ?? {
    content,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: request.model,
  };
}

async function retry<T>(
  operation: () => Promise<T>,
  policy: LLMRetryPolicy,
  signal: AbortSignal,
  logger?: Logger,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal.aborted) throw new Error('LLM request aborted');
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < policy.maxAttempts && (policy.shouldRetry?.(error, attempt) ?? true);
      if (!canRetry) break;
      const delayMs = Math.min(
        policy.maxDelayMs ?? 1_000,
        (policy.baseDelayMs ?? 25) * 2 ** (attempt - 1),
      );
      logger?.warn('Retrying LLM request', { attempt, delayMs, error: error instanceof Error ? error.message : String(error) });
      await delay(delayMs, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error('LLM retry delay aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
