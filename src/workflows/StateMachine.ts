/**
 * State machine for workflow run lifecycle.
 *
 * Run states: pending → running → completed | failed | cancelled
 * Step states: pending → running → completed | failed | skipped
 */

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

const VALID_RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const VALID_STEP_TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['running', 'skipped'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
  skipped: [],
};

export function isValidRunTransition(from: RunStatus, to: RunStatus): boolean {
  return VALID_RUN_TRANSITIONS[from].includes(to);
}

export function isValidStepTransition(from: StepStatus, to: StepStatus): boolean {
  return VALID_STEP_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!isValidRunTransition(from, to)) {
    throw new Error(`Invalid run state transition: ${from} → ${to}`);
  }
}

export function assertStepTransition(from: StepStatus, to: StepStatus): void {
  if (!isValidStepTransition(from, to)) {
    throw new Error(`Invalid step state transition: ${from} → ${to}`);
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function isTerminalStepStatus(status: StepStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}
