import type { LLMClient } from './LLMClient.js';
import { createOpenAICompatibleChatClient } from './OpenAICompatibleChatClient.js';

export interface NvidiaClientConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export function createNvidiaClient(config: NvidiaClientConfig): LLMClient {
  return createOpenAICompatibleChatClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULT_NVIDIA_BASE_URL,
    provider: 'nvidia',
  });
}
