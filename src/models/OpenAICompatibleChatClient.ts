import type { LLMClient, LLMRequest, LLMResponse, LLMStreamEvent, ToolCallRequest } from './LLMClient.js';

export interface OpenAICompatibleChatClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly provider: string;
  readonly headers?: Record<string, string>;
}

interface ChatCompletionToolCall {
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface ChatCompletionChoice {
  readonly message?: {
    readonly content?: string | null;
    readonly tool_calls?: readonly ChatCompletionToolCall[];
  };
  readonly finish_reason?: string;
}

interface ChatCompletionResponse {
  readonly choices?: readonly ChatCompletionChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

/** Generic client for any OpenAI-compatible `/chat/completions` endpoint (NVIDIA NIM, Groq, local vLLM, etc.). */
export function createOpenAICompatibleChatClient(config: OpenAICompatibleChatClientConfig): LLMClient {
  return {
    metadata: {
      provider: config.provider,
      supportsStreaming: false,
      supportsTools: true,
    },

    async call(request: LLMRequest): Promise<LLMResponse> {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify(toChatCompletionRequest(request)),
        signal: request.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${config.provider} request failed with ${response.status}: ${body || response.statusText}`);
      }

      return fromChatCompletionResponse(await response.json() as ChatCompletionResponse, request.model);
    },

    async *stream(request: LLMRequest): AsyncGenerator<LLMStreamEvent> {
      try {
        yield { type: 'complete', response: await this.call(request) };
      } catch (error) {
        yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  };
}

function toChatCompletionRequest(request: LLMRequest): Record<string, unknown> {
  const messages = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.role === 'tool' ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: toolCall.arguments },
          })),
        }
      : {}),
  }));

  return {
    model: request.model,
    messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: toChatCompletionToolParameters(tool.parameters),
            },
          })),
        }
      : {}),
  };
}

function toChatCompletionToolParameters(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {} };
  }
  const schema = parameters as Record<string, unknown>;
  if (schema.type === 'object' && !('properties' in schema)) {
    return { ...schema, properties: {} };
  }
  return schema;
}

function fromChatCompletionResponse(response: ChatCompletionResponse, model: string): LLMResponse {
  const choice = response.choices?.[0];
  const toolCalls: ToolCallRequest[] = (choice?.message?.tool_calls ?? []).flatMap((toolCall, index) => {
    if (!toolCall.function?.name) return [];
    return [{
      id: toolCall.id ?? `call_${index + 1}`,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments ?? '{}',
    }];
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  return {
    content: choice?.message?.content ?? '',
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: response.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    model,
  };
}
