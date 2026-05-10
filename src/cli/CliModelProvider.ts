import type { LLMClient } from '../models/LLMClient.js';
import { createMockLLMClient } from '../models/LLMClient.js';
import { createOpenAIClient } from '../models/OpenAIClient.js';
import type { CliConfig, CliDiagnostic } from './CliConfig.js';
import { CliError } from './CliError.js';

export interface CliModelProvider {
  readonly name: string;
  createClient(config: CliConfig, env?: NodeJS.ProcessEnv): Promise<LLMClient>;
  validateConfig(config: CliConfig, env?: NodeJS.ProcessEnv): readonly CliDiagnostic[];
}

export function createDefaultModelProviders(): readonly CliModelProvider[] {
  return [mockProvider(), openAIProvider()];
}

export function resolveModelProvider(name: string, providers: readonly CliModelProvider[]): CliModelProvider {
  const provider = providers.find((candidate) => candidate.name === name);
  if (!provider) throw new CliError('unknown_provider', `Unknown model provider "${name}".`);
  return provider;
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
        model: config.model,
      }]);
    },
    validateConfig() {
      return [{ level: 'info', code: 'mock_provider', message: 'Mock provider is available.' }];
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
  };
}

