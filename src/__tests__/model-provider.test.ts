import { describe, expect, it } from 'vitest';
import { createDefaultModelProviders, resolveModelProvider } from '../index.js';
import type { CliConfig } from '../cli/CliConfig.js';

function baseConfig(): CliConfig {
  return {
    agentId: 'default',
    storagePath: '.runtime',
    cwd: process.cwd(),
    envPath: '.env',
    toolsPath: 'tools',
    outputMode: 'text',
    debug: false,
    noColor: false,
  };
}

describe('CliModelProvider registry', () => {
  it('registers mock, openai, and nvidia by default', () => {
    const names = createDefaultModelProviders().map((provider) => provider.name);
    expect(names).toEqual(['mock', 'openai', 'nvidia']);
  });

  it('resolves the nvidia provider by name', () => {
    const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
    expect(provider.name).toBe('nvidia');
  });

  it('throws for an unknown provider name', () => {
    expect(() => resolveModelProvider('does-not-exist', createDefaultModelProviders())).toThrow(/Unknown model provider/);
  });

  describe('nvidia validateConfig', () => {
    it('reports an error when NVIDIA_API_KEY is missing', () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      const diagnostics = provider.validateConfig(baseConfig(), {});
      expect(diagnostics).toEqual([
        { level: 'error', code: 'missing_nvidia_api_key', message: 'NVIDIA_API_KEY is not set.' },
      ]);
    });

    it('reports info when NVIDIA_API_KEY is present', () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      const diagnostics = provider.validateConfig(baseConfig(), { NVIDIA_API_KEY: 'k' });
      expect(diagnostics).toEqual([
        { level: 'info', code: 'nvidia_api_key_present', message: 'NVIDIA_API_KEY is set.' },
      ]);
    });
  });

  describe('nvidia createClient', () => {
    it('throws a CliError when NVIDIA_API_KEY is missing', async () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      await expect(provider.createClient(baseConfig(), {})).rejects.toThrow(/NVIDIA_API_KEY is required/);
    });

    it('builds a client when NVIDIA_API_KEY is present', async () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      const client = await provider.createClient(baseConfig(), { NVIDIA_API_KEY: 'k' });
      expect(client.metadata?.provider).toBe('nvidia');
    });
  });

  describe('listModels', () => {
    it('mock provider returns its one static entry', () => {
      const provider = resolveModelProvider('mock', createDefaultModelProviders());
      expect(provider.listModels()).toEqual([{ id: 'mock-echo', label: 'Mock Echo' }]);
    });

    it('openai provider returns curated defaults with no env override', () => {
      const provider = resolveModelProvider('openai', createDefaultModelProviders());
      const models = provider.listModels({});
      expect(models.map((model) => model.id)).toEqual(['gpt-5.4-mini', 'gpt-5.4']);
    });

    it('openai provider honors OPENAI_MODELS as a comma-separated override', () => {
      const provider = resolveModelProvider('openai', createDefaultModelProviders());
      const models = provider.listModels({ OPENAI_MODELS: 'a, ,b ' });
      expect(models).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('nvidia provider returns curated defaults with no env override', () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      const models = provider.listModels({});
      expect(models.map((model) => model.id)).toEqual([
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.1-405b-instruct',
        'nvidia/nemotron-4-340b-instruct',
      ]);
    });

    it('nvidia provider honors NVIDIA_MODELS as a comma-separated override', () => {
      const provider = resolveModelProvider('nvidia', createDefaultModelProviders());
      const models = provider.listModels({ NVIDIA_MODELS: 'meta/llama-3.1-8b-instruct' });
      expect(models).toEqual([{ id: 'meta/llama-3.1-8b-instruct' }]);
    });

    it('falls back to curated defaults when the env override is empty/whitespace', () => {
      const provider = resolveModelProvider('openai', createDefaultModelProviders());
      const models = provider.listModels({ OPENAI_MODELS: '   ' });
      expect(models.map((model) => model.id)).toEqual(['gpt-5.4-mini', 'gpt-5.4']);
    });

    it('openai provider falls back to the legacy singular OPENAI_MODEL when OPENAI_MODELS is unset', () => {
      const provider = resolveModelProvider('openai', createDefaultModelProviders());
      const models = provider.listModels({ OPENAI_MODEL: 'gpt-5.4-turbo' });
      expect(models).toEqual([{ id: 'gpt-5.4-turbo' }]);
    });

    it('OPENAI_MODELS (plural) takes precedence over OPENAI_MODEL (singular) when both are set', () => {
      const provider = resolveModelProvider('openai', createDefaultModelProviders());
      const models = provider.listModels({ OPENAI_MODEL: 'ignored', OPENAI_MODELS: 'a,b' });
      expect(models).toEqual([{ id: 'a' }, { id: 'b' }]);
    });
  });
});
