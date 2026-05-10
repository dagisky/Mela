import { CircuitBreakerState, type CircuitBreakerConfig, type CircuitBreakerSnapshot } from '../types/index.js';

/**
 * Per-agent-type circuit breaker.
 *
 * States:
 *   CLOSED  → normal operation, failures are counted
 *   OPEN    → all calls rejected, in cooldown period
 *   HALF_OPEN → testing recovery, one call allowed
 */
export class AgentCircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.Closed;
  private failureCount = 0;
  private successCount = 0;
  private consecutiveFailures = 0;
  private lastFailureAt?: Date;
  private lastStateChangeAt = new Date();

  constructor(
    private readonly agentType: string,
    private readonly config: CircuitBreakerConfig,
  ) {}

  /**
   * Check if an invocation is allowed.
   */
  canInvoke(): { allowed: boolean; reason?: string } {
    switch (this.state) {
      case CircuitBreakerState.Closed:
        return { allowed: true };

      case CircuitBreakerState.Open: {
        const elapsed = Date.now() - this.lastStateChangeAt.getTime();
        if (elapsed >= this.config.cooldownMs) {
          this.transitionTo(CircuitBreakerState.HalfOpen);
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Circuit open for "${this.agentType}". Retry after ${this.config.cooldownMs - elapsed}ms`,
        };
      }

      case CircuitBreakerState.HalfOpen:
        return { allowed: true };

      default:
        return { allowed: true };
    }
  }

  /**
   * Record the outcome of an invocation.
   */
  recordOutcome(success: boolean): void {
    if (success) {
      this.successCount++;
      this.consecutiveFailures = 0;

      if (this.state === CircuitBreakerState.HalfOpen) {
        if (this.successCount >= this.config.recoveryThreshold) {
          this.transitionTo(CircuitBreakerState.Closed);
          this.failureCount = 0;
          this.successCount = 0;
        }
      }
    } else {
      this.failureCount++;
      this.consecutiveFailures++;
      this.lastFailureAt = new Date();

      if (this.state === CircuitBreakerState.HalfOpen) {
        this.transitionTo(CircuitBreakerState.Open);
        return;
      }

      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.transitionTo(CircuitBreakerState.Open);
        return;
      }

      const total = this.failureCount + this.successCount;
      if (total >= this.config.minimumInvocations) {
        const failureRate = this.failureCount / total;
        if (failureRate >= this.config.failureRateThreshold) {
          this.transitionTo(CircuitBreakerState.Open);
        }
      }
    }
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastStateChangeAt: this.lastStateChangeAt,
    };
  }

  reset(): void {
    this.state = CircuitBreakerState.Closed;
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.lastFailureAt = undefined;
    this.lastStateChangeAt = new Date();
  }

  private transitionTo(newState: CircuitBreakerState): void {
    this.state = newState;
    this.lastStateChangeAt = new Date();
  }
}
