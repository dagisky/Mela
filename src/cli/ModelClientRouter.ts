import type { LLMClient, LLMClientResolver } from '../models/LLMClient.js';
import { DEFAULT_CLI_CONFIG, type CliConfig } from './CliConfig.js';
import { resolveModelProvider, type CliModelProvider } from './CliModelProvider.js';

/**
 * CLI-aware LLMClientResolver: resolves a client by provider name, lazily
 * constructing (and caching) one client per provider so credentials for a
 * provider are only required once an agent actually requests it.
 */
export function createCliModelClientRouter(
  providers: readonly CliModelProvider[],
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env,
): LLMClientResolver {
  const cache = new Map<string, Promise<LLMClient>>();
  return {
    resolve(providerHint) {
      const name = providerHint ?? config.provider ?? DEFAULT_CLI_CONFIG.provider;
      let pending = cache.get(name);
      if (!pending) {
        pending = resolveModelProvider(name, providers).createClient(config, env);
        cache.set(name, pending);
      }
      return pending;
    },
  };
}
