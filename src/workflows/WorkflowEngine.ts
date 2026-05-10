import type {
  WorkflowDefinition, WorkflowStep, WorkflowRunState, StepResult,
  RunId, CorrelationId, ProjectId, UserId,
} from '../types/index.js';
import { generateId } from '../types/index.js';
import type { Logger } from '../types/index.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import type { LLMClient } from '../models/LLMClient.js';
import { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { ConversationEngine } from '../runtime/ConversationEngine.js';
import { EventBus } from '../observability/EventBus.js';
import { assertRunTransition, isTerminalRunStatus, type RunStatus } from './StateMachine.js';
import { ReviewQueue } from '../human/ReviewQueue.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import type { PolicyEngine } from '../policy/PolicyEngine.js';
import type { ApprovalRequester } from '../human/ApprovalManager.js';
import type { ContextBudgetManager } from '../context/ContextBudgetManager.js';
import type { OutputValidator } from '../validation/OutputValidator.js';

export interface WorkflowEngineConfig {
  readonly agentRegistry: AgentRegistry;
  readonly toolRegistry: RuntimeToolRegistry;
  readonly llmClient: LLMClient;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly store?: PersistenceStore;
  readonly policyEngine?: PolicyEngine;
  readonly approvalManager?: ApprovalRequester;
  readonly contextBudgetManager?: ContextBudgetManager;
  readonly outputValidator?: OutputValidator;
  readonly reviewQueue?: ReviewQueue;
  readonly workflowProvider?: WorkflowProvider;
  readonly conditionEvaluator?: WorkflowConditionEvaluator;
}

export interface WorkflowProvider {
  load(workflowId: WorkflowDefinition['id']): Promise<WorkflowDefinition>;
}

export type WorkflowConditionEvaluator = (
  condition: string,
  context: {
    readonly previousResults: readonly StepResult[];
    readonly userMessage: string;
  },
) => boolean | Promise<boolean>;

export interface WorkflowRunInput {
  readonly workflowDefinition: WorkflowDefinition;
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly userMessage: string;
  readonly contextPayload?: string;
  readonly signal: AbortSignal;
}

export async function executeWorkflow(
  config: WorkflowEngineConfig,
  input: WorkflowRunInput,
): Promise<WorkflowRunState> {
  const runId = generateId<RunId>();
  const correlationId = generateId<CorrelationId>();

  const state: Mutable<WorkflowRunState> = {
    runId,
    workflowId: input.workflowDefinition.id,
    projectId: input.projectId,
    userId: input.userId,
    correlationId,
    status: 'pending',
    currentStepIndex: 0,
    stepResults: [],
    startedAt: new Date(),
  };

  transitionRun(state, 'running');
  await config.eventBus.emit({
    type: 'workflow.started',
    timestamp: new Date(),
    correlationId,
    runId,
    workflowId: input.workflowDefinition.id,
  });

  try {
    for (let index = 0; index < input.workflowDefinition.steps.length; index++) {
      if (input.signal.aborted) {
        transitionRun(state, 'cancelled');
        break;
      }

      state.currentStepIndex = index;
      const step = input.workflowDefinition.steps[index]!;
      await emitStateTransition(config, runId, correlationId, 'pending', 'running', `step:${step.id}:start`);
      const stepResult = await executeStep(step, {
        runId,
        correlationId,
        userMessage: input.userMessage,
        previousResults: state.stepResults,
        signal: input.signal,
        config,
        projectId: input.projectId,
        userId: input.userId,
      });

      (state.stepResults as StepResult[]).push(stepResult);
      await emitStateTransition(config, runId, correlationId, 'running', stepResult.status, `step:${step.id}:finish`);
      if (stepResult.status === 'failed') {
        transitionRun(state, 'failed');
        state.error = stepResult.error;
        break;
      }
    }

    if (!isTerminalRunStatus(state.status)) {
      transitionRun(state, 'completed');
    }
  } catch (error) {
    transitionRun(state, 'failed');
    state.error = error instanceof Error ? error.message : String(error);
  }

  state.completedAt = new Date();
  const durationMs = state.completedAt.getTime() - state.startedAt.getTime();
  await emitCompletion(config, input.workflowDefinition, state, durationMs);
  config.logger.info('Workflow completed', {
    runId,
    status: state.status,
    steps: state.stepResults.length,
    durationMs,
  });

  return state as WorkflowRunState;
}

interface StepExecutionContext {
  readonly runId: RunId;
  readonly correlationId: CorrelationId;
  readonly userMessage: string;
  readonly previousResults: readonly StepResult[];
  readonly signal: AbortSignal;
  readonly config: WorkflowEngineConfig;
  readonly projectId: ProjectId;
  readonly userId: UserId;
}

async function executeStep(
  step: WorkflowStep,
  ctx: StepExecutionContext,
): Promise<StepResult> {
  const startedAt = new Date();

  try {
    switch (step.type) {
      case 'agent':
        return finishStep(step.id, startedAt, await executeAgentStep(step, ctx));

      case 'tool':
        return finishStep(step.id, startedAt, await executeToolStep(step, ctx));

      case 'parallel': {
        const branchResults = await executeParallelStep(step, ctx);
        const completedCount = branchResults.filter((result) => result.status === 'completed').length;
        const completed = step.joinStrategy === 'wait_majority'
          ? completedCount > branchResults.length / 2
          : completedCount === branchResults.length;
        return finishStep(step.id, startedAt, {
          status: completed ? 'completed' : 'failed',
          output: branchResults.map((result) => result.output),
          error: completed ? undefined : 'Parallel join strategy was not satisfied.',
        });
      }

      case 'conditional': {
        const conditionMet = await evaluateCondition(step, ctx);
        const targetStep = conditionMet ? step.ifTrue : step.ifFalse;
        return targetStep
          ? executeStep(targetStep, ctx)
          : finishStep(step.id, startedAt, { status: 'skipped' });
      }

      case 'human_gate':
        return finishStep(step.id, startedAt, await executeHumanGateStep(step, ctx));

      case 'sub_workflow':
        return finishStep(step.id, startedAt, await executeSubWorkflowStep(step, ctx));

      default:
        throw new Error(`Unknown step type: ${(step as { type?: string }).type}`);
    }
  } catch (error) {
    return finishStep(step.id, startedAt, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeAgentStep(
  step: Extract<WorkflowStep, { type: 'agent' }>,
  ctx: StepExecutionContext,
): Promise<StepCoreResult> {
  const agent = ctx.config.agentRegistry.getOrThrow(step.agentId);
  const engine = new ConversationEngine({
    llmClient: ctx.config.llmClient,
    toolRegistry: ctx.config.toolRegistry,
    store: ctx.config.store,
    policyEngine: ctx.config.policyEngine,
    approvalManager: ctx.config.approvalManager,
    contextBudgetManager: ctx.config.contextBudgetManager,
    outputValidator: ctx.config.outputValidator,
  });

  await ctx.config.eventBus.emit({
    type: 'agent.started',
    timestamp: new Date(),
    correlationId: ctx.correlationId,
    runId: ctx.runId,
    agentId: agent.id,
    stepId: step.id,
  });

  const result = await engine.submit({
    agentDefinition: agent,
    userMessage: ctx.userMessage,
    userId: ctx.userId,
    projectId: ctx.projectId,
    signal: ctx.signal,
  });

  if (result.status === 'success') {
    await ctx.config.eventBus.emit({
      type: 'agent.completed',
      timestamp: new Date(),
      correlationId: ctx.correlationId,
      runId: ctx.runId,
      agentId: agent.id,
      stepId: step.id,
      durationMs: 0,
      tokenUsage: result.usage ?? { prompt: 0, completion: 0 },
    });
  } else {
    await ctx.config.eventBus.emit({
      type: 'agent.failed',
      timestamp: new Date(),
      correlationId: ctx.correlationId,
      runId: ctx.runId,
      agentId: agent.id,
      stepId: step.id,
      error: result.message,
    });
  }

  return {
    status: result.status === 'success' ? 'completed' : 'failed',
    output: result.message,
    error: result.status === 'success' ? undefined : result.message,
  };
}

async function executeToolStep(
  step: Extract<WorkflowStep, { type: 'tool' }>,
  ctx: StepExecutionContext,
): Promise<StepCoreResult> {
  const executor = new ToolExecutor({
    registry: ctx.config.toolRegistry,
    store: ctx.config.store,
    policyEngine: ctx.config.policyEngine,
    approvalManager: ctx.config.approvalManager,
  });
  await ctx.config.eventBus.emit({
    type: 'tool.invoked',
    timestamp: new Date(),
    correlationId: ctx.correlationId,
    runId: ctx.runId,
    toolName: step.toolName,
    stepId: step.id,
    input: step.input,
  });
  const startedAt = Date.now();
  const result = await executor.executeToolOrError(
    { id: `${step.id}:tool`, name: step.toolName, input: step.input },
    {
      runId: ctx.runId,
      sessionId: ctx.runId,
      correlationId: ctx.correlationId,
      definitionVersions: {},
      toolNames: ctx.config.toolRegistry.names(),
      permissionContext: undefined,
      budgets: { maxTurns: 1, maxToolCalls: 1, maxContextTokens: 1 },
      signal: ctx.signal,
      metadata: {},
    },
  );
  await ctx.config.eventBus.emit({
    type: result.isError ? 'tool.failed' : 'tool.completed',
    timestamp: new Date(),
    correlationId: ctx.correlationId,
    runId: ctx.runId,
    toolName: step.toolName,
    stepId: step.id,
    ...(result.isError
      ? { error: result.content }
      : { durationMs: Date.now() - startedAt, success: true }),
  });

  return {
    status: result.isError ? 'failed' : 'completed',
    output: result.isError ? undefined : result.content,
    error: result.isError ? result.content : undefined,
  };
}

async function executeParallelStep(
  step: Extract<WorkflowStep, { type: 'parallel' }>,
  ctx: StepExecutionContext,
): Promise<readonly StepResult[]> {
  const branchPromises = step.branches.map((branch) => executeStep(branch, ctx));
  if (step.joinStrategy === 'wait_all') return Promise.all(branchPromises);

  if (step.joinStrategy === 'wait_first') {
    return [await Promise.any(branchPromises)];
  }

  const results = await Promise.all(branchPromises);
  const completedCount = results.filter((result) => result.status === 'completed').length;
  return completedCount > results.length / 2
    ? results.map((result) => result.status === 'failed' ? { ...result, status: 'skipped' as const } : result)
    : results;
}

async function evaluateCondition(
  step: Extract<WorkflowStep, { type: 'conditional' }>,
  ctx: StepExecutionContext,
): Promise<boolean> {
  if (ctx.config.conditionEvaluator) {
    return ctx.config.conditionEvaluator(step.condition, {
      previousResults: ctx.previousResults,
      userMessage: ctx.userMessage,
    });
  }
  const lastResult = ctx.previousResults[ctx.previousResults.length - 1];
  if (step.condition === 'last_completed') return lastResult?.status === 'completed';
  if (step.condition === 'last_failed') return lastResult?.status === 'failed';
  return Boolean(lastResult?.output);
}

async function executeSubWorkflowStep(
  step: Extract<WorkflowStep, { type: 'sub_workflow' }>,
  ctx: StepExecutionContext,
): Promise<StepCoreResult> {
  if (!ctx.config.workflowProvider) {
    return {
      status: 'failed',
      error: `No workflowProvider configured for sub-workflow "${step.workflowId}".`,
    };
  }
  const workflowDefinition = await ctx.config.workflowProvider.load(step.workflowId);
  const result = await executeWorkflow(ctx.config, {
    workflowDefinition,
    projectId: ctx.projectId,
    userId: ctx.userId,
    userMessage: typeof step.input?.['userMessage'] === 'string' ? step.input['userMessage'] : ctx.userMessage,
    signal: ctx.signal,
  });
  return {
    status: result.status === 'completed' ? 'completed' : 'failed',
    output: result,
    error: result.status === 'completed' ? undefined : result.error ?? `Sub-workflow "${step.workflowId}" failed.`,
  };
}

async function executeHumanGateStep(
  step: Extract<WorkflowStep, { type: 'human_gate' }>,
  ctx: StepExecutionContext,
): Promise<StepCoreResult> {
  if (!ctx.config.reviewQueue) {
    ctx.config.logger.warn('Human gate auto-approved because no review queue is configured', { stepId: step.id });
    return { status: 'completed', output: { decision: 'auto_approved' } };
  }

  const reviewId = ctx.config.reviewQueue.submit(
    ctx.runId,
    step.id,
    'workflow',
    step.reviewPrompt,
    ctx.previousResults[ctx.previousResults.length - 1]?.output,
  );

  try {
    const decision = await ctx.config.reviewQueue.waitForDecision(reviewId, step.timeoutMs, ctx.signal);
    return {
      status: decision.approved ? 'completed' : 'failed',
      output: { decision: decision.approved ? 'approved' : 'rejected', rationale: decision.rationale, reviewId },
      error: decision.approved ? undefined : `Rejected: ${decision.rationale ?? 'no rationale'}`,
    };
  } catch {
    return {
      status: step.fallbackAction === 'approve' ? 'completed' : 'failed',
      output: { decision: `fallback_${step.fallbackAction}`, reviewId },
      error: step.fallbackAction === 'reject' ? 'Review timed out and fallback is reject' : undefined,
    };
  }
}

interface StepCoreResult {
  readonly status: StepResult['status'];
  readonly output?: unknown;
  readonly error?: string;
}

function finishStep(stepId: StepResult['stepId'], startedAt: Date, result: StepCoreResult): StepResult {
  return {
    stepId,
    status: result.status,
    output: result.output,
    error: result.error,
    startedAt,
    completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
  };
}

async function emitCompletion(
  config: WorkflowEngineConfig,
  workflow: WorkflowDefinition,
  state: Mutable<WorkflowRunState>,
  durationMs: number,
): Promise<void> {
  if (state.status === 'completed') {
    await config.eventBus.emit({
      type: 'workflow.completed',
      timestamp: new Date(),
      correlationId: state.correlationId,
      runId: state.runId,
      workflowId: workflow.id,
      durationMs,
      stepsCompleted: state.stepResults.length,
    });
    return;
  }

  if (state.status === 'failed') {
    await config.eventBus.emit({
      type: 'workflow.failed',
      timestamp: new Date(),
      correlationId: state.correlationId,
      runId: state.runId,
      workflowId: workflow.id,
      error: state.error ?? 'Unknown error',
    });
  }
}

async function emitStateTransition(
  config: WorkflowEngineConfig,
  runId: RunId,
  correlationId: CorrelationId,
  fromState: string,
  toState: string,
  trigger: string,
): Promise<void> {
  await config.eventBus.emit({
    type: 'state.transition',
    timestamp: new Date(),
    correlationId,
    runId,
    fromState,
    toState,
    trigger,
  });
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] extends readonly (infer U)[] ? U[] : T[P] };

function transitionRun(state: Mutable<WorkflowRunState>, to: RunStatus): void {
  assertRunTransition(state.status as RunStatus, to);
  state.status = to;
}
