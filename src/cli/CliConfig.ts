export type CliProvider = 'mock' | 'openai' | string;
export type CliOutputMode = 'text' | 'json' | 'ndjson';

export interface CliConfig {
  readonly agentId: string;
  readonly storagePath: string;
  readonly provider: CliProvider;
  readonly model: string;
  readonly cwd: string;
  readonly envPath: string;
  readonly toolsPath: string;
  readonly outputMode: CliOutputMode;
  readonly debug: boolean;
  readonly noColor: boolean;
  readonly prompt?: string;
}

export const DEFAULT_CLI_CONFIG = {
  agentId: 'default',
  storagePath: '.runtime',
  provider: 'openai',
  model: 'gpt-5.4-mini',
  envPath: '.env',
  toolsPath: 'tools',
} as const;

export function createCliConfig(input: Partial<CliConfig> = {}, env: NodeJS.ProcessEnv = process.env): CliConfig {
  return {
    agentId: input.agentId ?? env.RIA_RUNTIME_AGENT ?? DEFAULT_CLI_CONFIG.agentId,
    storagePath: input.storagePath ?? env.RIA_RUNTIME_STORAGE ?? DEFAULT_CLI_CONFIG.storagePath,
    provider: input.provider ?? env.RIA_RUNTIME_PROVIDER ?? DEFAULT_CLI_CONFIG.provider,
    model: input.model ?? env.OPENAI_MODEL ?? DEFAULT_CLI_CONFIG.model,
    cwd: input.cwd ?? process.cwd(),
    envPath: input.envPath ?? DEFAULT_CLI_CONFIG.envPath,
    toolsPath: input.toolsPath ?? env.RIA_RUNTIME_TOOLS ?? DEFAULT_CLI_CONFIG.toolsPath,
    outputMode: input.outputMode ?? 'text',
    debug: input.debug ?? false,
    noColor: input.noColor ?? false,
    prompt: input.prompt,
  };
}

export interface CliDiagnostic {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly data?: unknown;
}
