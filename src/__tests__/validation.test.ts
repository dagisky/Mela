import { describe, it, expect } from 'vitest';
import { OutputValidator, SchemaValidationStage, ConfidenceCheckStage } from '../validation/OutputValidator.js';
import { createLogger } from '../types/index.js';

const logger = createLogger({ serviceName: 'test', logLevel: 'silent', environment: 'test' });

describe('OutputValidator', () => {
  it('accepts valid output through all stages', async () => {
    const validator = new OutputValidator(logger);
    validator.addStage(new SchemaValidationStage());
    validator.addStage(new ConfidenceCheckStage(0.5));

    const output = { confidence: { composite: 0.9 }, answer: 'test' };
    const result = await validator.validate(output, { agentType: 'synthesis', projectId: 'proj-1' });

    expect(result.decision).toBe('accept');
    expect(result.stages).toHaveLength(2);
    expect(result.stages.every((s) => s.passed)).toBe(true);
  });

  it('rejects null output at schema stage', async () => {
    const validator = new OutputValidator(logger);
    validator.addStage(new SchemaValidationStage());
    validator.addStage(new ConfidenceCheckStage(0.5));

    const result = await validator.validate(null, { agentType: 'synthesis', projectId: 'proj-1' });

    expect(result.decision).toBe('reject');
    expect(result.rejectingStage).toBe('schema_validation');
    expect(result.stages).toHaveLength(1); // Early termination
  });

  it('flags low confidence for review', async () => {
    const validator = new OutputValidator(logger);
    validator.addStage(new SchemaValidationStage());
    validator.addStage(new ConfidenceCheckStage(0.8));

    const output = { confidence: { composite: 0.6 } };
    const result = await validator.validate(output, { agentType: 'synthesis', projectId: 'proj-1' });

    expect(result.decision).toBe('reject');
    expect(result.rejectingStage).toBe('confidence_check');
  });
});
