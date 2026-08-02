import type { LLMClient } from '../models/LLMClient.js';
import { createMockLLMClient } from '../models/LLMClient.js';
import { createOpenAIClient } from '../models/OpenAIClient.js';
import { createNvidiaClient } from '../models/NvidiaClient.js';
import { DEFAULT_CLI_CONFIG, type CliConfig, type CliDiagnostic } from './CliConfig.js';
import { CliError } from './CliError.js';

export interface ModelDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
}

export interface CliModelProvider {
  readonly name: string;
  createClient(config: CliConfig, env?: NodeJS.ProcessEnv): Promise<LLMClient>;
  validateConfig(config: CliConfig, env?: NodeJS.ProcessEnv): readonly CliDiagnostic[];
  listModels(env?: NodeJS.ProcessEnv): readonly ModelDescriptor[];
}

export function createDefaultModelProviders(): readonly CliModelProvider[] {
  return [mockProvider(), openAIProvider(), nvidiaProvider()];
}

export function resolveModelProvider(name: string, providers: readonly CliModelProvider[]): CliModelProvider {
  const provider = providers.find((candidate) => candidate.name === name);
  if (!provider) throw new CliError('unknown_provider', `Unknown model provider "${name}".`);
  return provider;
}

function parseModelList(raw: string | undefined): readonly ModelDescriptor[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids.map((id) => ({ id })) : undefined;
}

function mockProvider(): CliModelProvider {
  return {
    name: 'mock',
    async createClient(config) {
      return createMockLLMClient([{
        content: `Mock response from ${config.agentId}: ${config.prompt ?? 'ready'}`,
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: config.model ?? DEFAULT_CLI_CONFIG.model,
      }]);
    },
    validateConfig() {
      return [{ level: 'info', code: 'mock_provider', message: 'Mock provider is available.' }];
    },
    listModels() {
      return [{ id: 'mock-echo', label: 'Mock Echo' }];
    },
  };
}

function openAIProvider(): CliModelProvider {
  return {
    name: 'openai',
    async createClient(_config, env = process.env) {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) throw new CliError('missing_openai_api_key', 'OPENAI_API_KEY is required for provider "openai".');
      return createOpenAIClient({ apiKey });
    },
    validateConfig(_config, env = process.env) {
      const diagnostics: CliDiagnostic[] = [];
      if (!env.OPENAI_API_KEY) {
        diagnostics.push({ level: 'error', code: 'missing_openai_api_key', message: 'OPENAI_API_KEY is not set.' });
      } else {
        diagnostics.push({ level: 'info', code: 'openai_api_key_present', message: 'OPENAI_API_KEY is set.' });
      }
      return diagnostics;
    },
    listModels(env = process.env) {
      return parseModelList(env.OPENAI_MODELS)
        ?? (env.OPENAI_MODEL ? [{ id: env.OPENAI_MODEL }] : undefined)
        ?? [
          { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Default — fast, low cost.' },
          { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Higher-capability variant.' },
        ];
    },
  };
}

function nvidiaProvider(): CliModelProvider {
  return {
    name: 'nvidia',
    async createClient(_config, env = process.env) {
      const apiKey = env.NVIDIA_API_KEY;
      if (!apiKey) throw new CliError('missing_nvidia_api_key', 'NVIDIA_API_KEY is required for provider "nvidia".');
      return createNvidiaClient({ apiKey, baseUrl: env.NVIDIA_BASE_URL });
    },
    validateConfig(_config, env = process.env) {
      const diagnostics: CliDiagnostic[] = [];
      if (!env.NVIDIA_API_KEY) {
        diagnostics.push({ level: 'error', code: 'missing_nvidia_api_key', message: 'NVIDIA_API_KEY is not set.' });
      } else {
        diagnostics.push({ level: 'info', code: 'nvidia_api_key_present', message: 'NVIDIA_API_KEY is set.' });
      }
      return diagnostics;
    },
    listModels(env = process.env) {
      return parseModelList(env.NVIDIA_MODELS) ?? [
        { id: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
        { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct' },
        { id: 'nvidia/nemotron-4-340b-instruct', label: 'Nemotron-4 340B Instruct' },
      ];
    },
  };
}

