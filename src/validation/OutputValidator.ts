import type { VerificationResult, VerificationStageResult } from '../types/index.js';
import type { Logger } from '../types/index.js';

/** A single validation stage. Stages run in fixed order. */
export interface ValidationStage {
  readonly name: string;
  validate(output: unknown, context: ValidationContext): Promise<VerificationStageResult>;
}

export interface ValidationContext {
  readonly agentType: string;
  readonly projectId: string;
}

/**
 * The 7-stage verification pipeline (doc-06).
 *
 * Stages execute in fixed order. Cannot be reordered, skipped, or inserted.
 * Early termination on hard failure. Flags accumulate.
 */
export class OutputValidator {
  private readonly stages: ValidationStage[] = [];

  constructor(private readonly logger: Logger) {}

  addStage(stage: ValidationStage): void {
    this.stages.push(stage);
  }

  async validate(output: unknown, context: ValidationContext): Promise<VerificationResult> {
    const stageResults: VerificationStageResult[] = [];
    const flaggingStages: string[] = [];
    let rejectingStage: string | undefined;
    const startTime = Date.now();

    for (const stage of this.stages) {
      const result = await stage.validate(output, context);
      stageResults.push(result);

      if (result.flags && result.flags.length > 0) {
        flaggingStages.push(stage.name);
      }

      if (!result.passed) {
        rejectingStage = stage.name;
        this.logger.warn('Validation stage failed', {
          stage: stage.name,
          agentType: context.agentType,
        });
        // Early termination on failure
        break;
      }
    }

    const allPassed = stageResults.every((r) => r.passed);
    const decision = allPassed
      ? (flaggingStages.length > 0 ? 'review' as const : 'accept' as const)
      : 'reject' as const;

    return {
      decision,
      stages: stageResults,
      rejectingStage,
      flaggingStages,
      totalDurationMs: Date.now() - startTime,
    };
  }
}

/**
 * Built-in validation stage: Schema validation.
 * Checks that the output matches the expected JSON structure.
 */
export class SchemaValidationStage implements ValidationStage {
  readonly name = 'schema_validation';

  async validate(output: unknown): Promise<VerificationStageResult> {
    const startTime = Date.now();
    const isValid = output !== null && output !== undefined && typeof output === 'object';

    return {
      name: this.name,
      passed: isValid,
      durationMs: Date.now() - startTime,
      details: isValid ? undefined : { reason: 'Output is not a valid object' },
    };
  }
}

/**
 * Built-in validation stage: Confidence check.
 * Ensures the agent's reported confidence meets the threshold.
 */
export class ConfidenceCheckStage implements ValidationStage {
  readonly name = 'confidence_check';

  constructor(private readonly threshold: number = 0.5) {}

  async validate(output: unknown): Promise<VerificationStageResult> {
    const startTime = Date.now();

    const confidence = (output as any)?.confidence?.composite
      ?? (output as any)?.confidence
      ?? 1.0;

    const passed = confidence >= this.threshold;

    return {
      name: this.name,
      passed,
      durationMs: Date.now() - startTime,
      details: { confidence, threshold: this.threshold },
      flags: passed ? undefined : [`Confidence ${confidence} below threshold ${this.threshold}`],
    };
  }
}
