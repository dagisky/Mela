import { describe, it, expect } from 'vitest';
import {
  isValidRunTransition, isValidStepTransition,
  assertRunTransition,
  isTerminalRunStatus, isTerminalStepStatus,
} from '../workflows/StateMachine.js';

describe('Run state machine', () => {
  it('allows valid transitions', () => {
    expect(isValidRunTransition('pending', 'running')).toBe(true);
    expect(isValidRunTransition('running', 'completed')).toBe(true);
    expect(isValidRunTransition('running', 'failed')).toBe(true);
    expect(isValidRunTransition('running', 'cancelled')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(isValidRunTransition('completed', 'running')).toBe(false);
    expect(isValidRunTransition('failed', 'completed')).toBe(false);
    expect(isValidRunTransition('pending', 'completed')).toBe(false);
  });

  it('assertRunTransition throws on invalid', () => {
    expect(() => assertRunTransition('completed', 'running')).toThrow('Invalid run state transition');
  });

  it('identifies terminal states', () => {
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('pending')).toBe(false);
  });
});

describe('Step state machine', () => {
  it('allows valid transitions', () => {
    expect(isValidStepTransition('pending', 'running')).toBe(true);
    expect(isValidStepTransition('running', 'completed')).toBe(true);
    expect(isValidStepTransition('pending', 'skipped')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(isValidStepTransition('completed', 'running')).toBe(false);
    expect(isValidStepTransition('skipped', 'running')).toBe(false);
  });

  it('identifies terminal step states', () => {
    expect(isTerminalStepStatus('completed')).toBe(true);
    expect(isTerminalStepStatus('failed')).toBe(true);
    expect(isTerminalStepStatus('skipped')).toBe(true);
    expect(isTerminalStepStatus('running')).toBe(false);
  });
});
