import type { RunContext } from '../types/index.js';
import type { RunSnapshot } from './PersistenceStore.js';

export function createRunSnapshot(context: RunContext): RunSnapshot {
  const { signal: _signal, ...serializableContext } = context;
  return {
    runId: context.runId,
    sessionId: context.sessionId,
    context: serializableContext,
    savedAt: new Date(),
  };
}

