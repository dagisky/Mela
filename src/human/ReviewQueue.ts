import { generateId } from '../types/index.js';
import type { Logger } from '../types/index.js';

export interface PendingReview {
  readonly id: string;
  readonly runId: string;
  readonly stepId: string;
  readonly agentType: string;
  readonly prompt: string;
  readonly context: unknown;
  readonly createdAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  decision?: {
    by: string;
    rationale?: string;
    decidedAt: Date;
  };
}

export interface ReviewDecisionResult {
  readonly approved: boolean;
  readonly rationale?: string;
}

/**
 * In-memory review queue for local testing.
 *
 * When a HumanGate step fires, the workflow submits a review here
 * and waits for a decision. The web portal lists pending reviews
 * and lets the user approve or reject.
 *
 * No database needed — reviews live in memory.
 */
export class ReviewQueue {
  private readonly reviews = new Map<string, PendingReview>();
  private readonly waiters = new Map<string, {
    resolve: (result: ReviewDecisionResult) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly logger: Logger) {}

  /** Submit a review request. Returns the review ID. */
  submit(runId: string, stepId: string, agentType: string, prompt: string, context?: unknown): string {
    const id = generateId<string>();
    const review: PendingReview = {
      id,
      runId,
      stepId,
      agentType,
      prompt,
      context,
      createdAt: new Date(),
      status: 'pending',
    };
    this.reviews.set(id, review);
    this.logger.info('Review submitted', { reviewId: id, stepId });
    return id;
  }

  /** List all reviews (optionally filter by status). */
  list(status?: 'pending' | 'approved' | 'rejected'): PendingReview[] {
    const all = Array.from(this.reviews.values());
    return status ? all.filter((r) => r.status === status) : all;
  }

  /** Get a single review by ID. */
  get(reviewId: string): PendingReview | undefined {
    return this.reviews.get(reviewId);
  }

  /** Decide on a review — resolves any waiter. */
  decide(reviewId: string, approved: boolean, rationale?: string): void {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review "${reviewId}" not found`);
    if (review.status !== 'pending') throw new Error(`Review "${reviewId}" already decided`);

    review.status = approved ? 'approved' : 'rejected';
    review.decision = { by: 'human', rationale, decidedAt: new Date() };

    const waiter = this.waiters.get(reviewId);
    if (waiter) {
      waiter.resolve({ approved, rationale });
      this.waiters.delete(reviewId);
    }

    this.logger.info('Review decided', { reviewId, approved });
  }

  /**
   * Wait for a decision on a review.
   * Called by the workflow engine's HumanGate step.
   * Resolves when decide() is called, or rejects on timeout/abort.
   */
  waitForDecision(reviewId: string, timeoutMs: number, signal: AbortSignal): Promise<ReviewDecisionResult> {
    // If already decided, return immediately
    const review = this.reviews.get(reviewId);
    if (review && review.status !== 'pending') {
      return Promise.resolve({
        approved: review.status === 'approved',
        rationale: review.decision?.rationale,
      });
    }

    return new Promise<ReviewDecisionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(reviewId);
        reject(new Error(`Review "${reviewId}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.waiters.delete(reviewId);
        reject(new Error('Review wait aborted'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      this.waiters.set(reviewId, {
        resolve: (result) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
    });
  }

  get size(): number {
    return this.reviews.size;
  }

  get pendingCount(): number {
    return Array.from(this.reviews.values()).filter((r) => r.status === 'pending').length;
  }
}
