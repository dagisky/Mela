import type { RuntimeBudgets } from '../types/index.js';

export interface RuntimeConfig {
  readonly defaultBudgets: RuntimeBudgets;
  readonly version?: string;
  readonly executionMode?: 'interactive' | 'autonomous' | 'batch' | 'event_triggered';
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  version: 'phase-1',
  executionMode: 'interactive',
  defaultBudgets: {
    maxTurns: 12,
    maxToolCalls: 40,
    maxContextTokens: 100_000,
  },
};

export function createRuntimeConfigSnapshot(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG): RuntimeConfig {
  return Object.freeze({
    version: config.version,
    executionMode: config.executionMode,
    defaultBudgets: Object.freeze({ ...config.defaultBudgets }),
  });
}
