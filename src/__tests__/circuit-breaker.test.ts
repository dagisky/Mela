import { describe, it, expect } from 'vitest';
import { AgentCircuitBreaker } from '../safety/AgentCircuitBreaker.js';
import { CircuitBreakerState } from '../types/index.js';

const defaultConfig = {
  failureRateThreshold: 0.5,
  windowMs: 60000,
  minimumInvocations: 5,
  cooldownMs: 100, // short for tests
  recoveryThreshold: 2,
  maxConsecutiveFailures: 3,
};

describe('AgentCircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.Closed);
    expect(cb.canInvoke().allowed).toBe(true);
  });

  it('opens after maxConsecutiveFailures', () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.Open);
    expect(cb.canInvoke().allowed).toBe(false);
  });

  it('transitions to HALF_OPEN after cooldown', async () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    expect(cb.canInvoke().allowed).toBe(false);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));
    const result = cb.canInvoke();
    expect(result.allowed).toBe(true);
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.HalfOpen);
  });

  it('closes after recovery threshold successes in HALF_OPEN', async () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.recordOutcome(false);

    await new Promise((r) => setTimeout(r, 150));
    cb.canInvoke(); // transitions to HALF_OPEN

    cb.recordOutcome(true);
    cb.recordOutcome(true);
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.Closed);
  });

  it('re-opens on failure in HALF_OPEN', async () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.recordOutcome(false);

    await new Promise((r) => setTimeout(r, 150));
    cb.canInvoke();

    cb.recordOutcome(false);
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.Open);
  });

  it('reset returns to CLOSED', () => {
    const cb = new AgentCircuitBreaker('synthesis', defaultConfig);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.recordOutcome(false);
    cb.reset();
    expect(cb.getSnapshot().state).toBe(CircuitBreakerState.Closed);
    expect(cb.canInvoke().allowed).toBe(true);
  });
});
