import { describe, expect, it } from 'vitest';
import { createRuntimeConfigSnapshot } from '../runtime/RuntimeConfig.js';

describe('runtime config snapshot', () => {
  it('creates an immutable snapshot of runtime config', () => {
    const snapshot = createRuntimeConfigSnapshot({
      version: 'test',
      executionMode: 'batch',
      defaultBudgets: {
        maxTurns: 2,
        maxToolCalls: 3,
        maxContextTokens: 4,
        maxCostUsd: 5,
      },
    });

    expect(snapshot).toEqual({
      version: 'test',
      executionMode: 'batch',
      defaultBudgets: {
        maxTurns: 2,
        maxToolCalls: 3,
        maxContextTokens: 4,
        maxCostUsd: 5,
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.defaultBudgets)).toBe(true);
  });
});
