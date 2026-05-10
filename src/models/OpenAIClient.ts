import type { LLMClient, LLMRequest, LLMResponse, LLMStreamEvent, ToolCallRequest } from './LLMClient.js';

export interface OpenAIClientConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

interface OpenAIResponseItem {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly call_id?: string;
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
}

interface OpenAIResponse {
  readonly id?: string;
  readonly output_text?: string;
  readonly output?: readonly OpenAIResponseItem[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
  };
}

export function createOpenAIClient(config: OpenAIClientConfig): LLMClient {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  return {
    metadata: {
      provider: 'openai',
      supportsStreaming: false,
      supportsTools: true,
    },

    async call(request: LLMRequest): Promise<LLMResponse> {
      const response = await fetch(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toOpenAIRequest(request)),
        signal: request.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI request failed with ${response.status}: ${body || response.statusText}`);
      }

      return fromOpenAIResponse(await response.json() as OpenAIResponse, request.model);
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

function toOpenAIRequest(request: LLMRequest): Record<string, unknown> {
  const system = request.messages.find((message) => message.role === 'system')?.content;
  const input = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'tool' ? 'user' : message.role,
      content: message.role === 'tool'
        ? `Tool result ${message.toolCallId ?? ''}: ${message.content}`
        : message.content,
    }));

  return {
    model: request.model,
    instructions: system,
    input,
    max_output_tokens: request.maxTokens,
    temperature: request.temperature,
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: toOpenAIToolParameters(tool.parameters),
          })),
        }
      : {}),
  };
}

function toOpenAIToolParameters(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {} };
  }
  const schema = parameters as Record<string, unknown>;
  if (schema.type === 'object' && !('properties' in schema)) {
    return { ...schema, properties: {} };
  }
  return schema;
}

function fromOpenAIResponse(response: OpenAIResponse, model: string): LLMResponse {
  const toolCalls: ToolCallRequest[] = [];
  const textParts: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type === 'function_call' && item.name) {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length + 1}`,
        name: item.name,
        arguments: item.arguments ?? '{}',
      });
    }
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) textParts.push(content.text);
      if (content.type === 'text' && content.text) textParts.push(content.text);
    }
  }

  const promptTokens = response.usage?.input_tokens ?? 0;
  const completionTokens = response.usage?.output_tokens ?? 0;
  return {
    content: response.output_text ?? textParts.join(''),
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
