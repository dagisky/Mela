import { randomUUID } from 'node:crypto';

declare const __brand: unique symbol;
export type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };

export type AgentId = Brand<string, 'AgentId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type StepId = Brand<string, 'StepId'>;
export type RunId = Brand<string, 'RunId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type UserId = Brand<string, 'UserId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ReviewRequestId = Brand<string, 'ReviewRequestId'>;
export type ReviewDecisionId = Brand<string, 'ReviewDecisionId'>;

export function generateId<T extends string = string>(): T {
  return randomUUID() as T;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(_options?: Record<string, unknown>): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

export enum ExecutionMode {
  Interactive = 'interactive',
  Autonomous = 'autonomous',
  Batch = 'batch',
  EventTriggered = 'event_triggered',
}

export enum CircuitBreakerState {
  Closed = 'closed',
  HalfOpen = 'half_open',
  Open = 'open',
}

export interface ModelConfig {
  readonly provider: 'anthropic' | 'openai' | string;
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP?: number;
  readonly stopSequences?: readonly string[];
}

export interface ReActConfig {
  readonly maxIterations: number;
  readonly confidenceThreshold: number;
  readonly stagnationWindow: number;
  readonly detectRepetition: boolean;
  readonly confidenceDeclineWindow: number;
}

export interface ContextConfig {
  readonly maxTokens: number;
  readonly retrievalStrategy: string;
  readonly includeEvidence: boolean;
  readonly includeConflicts: boolean;
  readonly includeGaps: boolean;
  readonly includeDiscoveries: boolean;
}

export interface EscalationConfig {
  readonly confidenceFloor: number;
  readonly requireHumanReview: boolean;
  readonly maxConsecutiveAutoApproves?: number;
}

export interface AgentLimits {
  readonly maxExecutionTimeMs: number;
  readonly maxLLMCalls: number;
  readonly maxToolCalls: number;
  readonly maxOutputSizeBytes: number;
  readonly maxContextTokens: number;
}

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly category: 'specialized' | 'meta-orchestrator' | 'utility';
  readonly version: string;
  readonly model: ModelConfig;
  readonly systemPrompt: string;
  readonly tools: readonly string[];
  readonly outputSchema: Record<string, unknown>;
  readonly reactConfig: ReActConfig;
  readonly contextConfig: ContextConfig;
  readonly escalation: EscalationConfig;
  readonly limits: AgentLimits;
  readonly executionModes: readonly ExecutionMode[];
  readonly metadata: Record<string, string>;
}

export type TerminalStatus =
  | 'success'
  | 'cancelled'
  | 'policy_denied'
  | 'definition_load_failed'
  | 'model_error'
  | 'model_error_retry_exhausted'
  | 'tool_error'
  | 'approval_rejected'
  | 'human_review_rejected'
  | 'max_turns'
  | 'max_context_budget'
  | 'resource_limit_exceeded'
  | 'validation_failed'
  | 'workflow_failed'
  | 'unknown_error';

export interface TerminalUsage {
  readonly prompt: number;
  readonly completion: number;
}

export interface TerminalResult {
  readonly status: TerminalStatus;
  readonly runId: string;
  readonly sessionId?: string;
  readonly correlationId: string;
  readonly message: string;
  readonly errorCode?: string;
  readonly usage?: TerminalUsage;
  readonly createdAt: Date;
  readonly traceId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RuntimeBudgets {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxContextTokens: number;
  readonly maxCostUsd?: number;
}

export interface RunContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly parentRunId?: string;
  readonly userId?: string;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly workflowId?: string;
  readonly definitionVersions: Readonly<Record<string, string>>;
  readonly toolNames: readonly string[];
  readonly permissionContext?: unknown;
  readonly budgets: RuntimeBudgets;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RuntimeEventRecord<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly timestamp: Date;
  readonly runId: string;
  readonly sessionId?: string;
  readonly correlationId: string;
  readonly payload: TPayload;
}

export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly steps: readonly WorkflowStep[];
  readonly metadata?: Record<string, string>;
}

export type WorkflowStep =
  | AgentStep
  | ToolStep
  | ParallelFanOut
  | ConditionalBranch
  | HumanGate
  | SubWorkflow;

export interface AgentStep {
  readonly type: 'agent';
  readonly id: StepId;
  readonly agentId: AgentId;
  readonly input?: Record<string, unknown>;
  readonly overrides?: Partial<{ maxIterations: number; confidenceThreshold: number }>;
}

export interface ToolStep {
  readonly type: 'tool';
  readonly id: StepId;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export interface ParallelFanOut {
  readonly type: 'parallel';
  readonly id: StepId;
  readonly branches: readonly WorkflowStep[];
  readonly joinStrategy: 'wait_all' | 'wait_first' | 'wait_majority';
}

export interface ConditionalBranch {
  readonly type: 'conditional';
  readonly id: StepId;
  readonly condition: string;
  readonly ifTrue: WorkflowStep;
  readonly ifFalse?: WorkflowStep;
}

export interface HumanGate {
  readonly type: 'human_gate';
  readonly id: StepId;
  readonly reviewPrompt: string;
  readonly timeoutMs: number;
  readonly fallbackAction: 'approve' | 'reject' | 'escalate';
}

export interface SubWorkflow {
  readonly type: 'sub_workflow';
  readonly id: StepId;
  readonly workflowId: WorkflowId;
  readonly input?: Record<string, unknown>;
}

export interface WorkflowRunState {
  readonly runId: RunId;
  readonly workflowId: WorkflowId;
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly correlationId: CorrelationId;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly currentStepIndex: number;
  readonly stepResults: readonly StepResult[];
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly error?: string;
}

export interface StepResult {
  readonly stepId: StepId;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly output?: unknown;
  readonly error?: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly durationMs?: number;
}

export interface ToolDefinition {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly permissions: {
    readonly requiresGraphRead: boolean;
    readonly requiresGraphWrite: boolean;
    readonly requiresVectorSearch: boolean;
    readonly requiresExternalApi: boolean;
  };
  readonly timeoutMs: number;
  readonly retryable: boolean;
  readonly idempotent: boolean;
}

export interface ToolOutput {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface ResourceLimits {
  readonly perInvocation: AgentLimits;
}

export interface CircuitBreakerConfig {
  readonly failureRateThreshold: number;
  readonly windowMs: number;
  readonly minimumInvocations: number;
  readonly cooldownMs: number;
  readonly recoveryThreshold: number;
  readonly maxConsecutiveFailures: number;
}

export interface CircuitBreakerSnapshot {
  readonly state: CircuitBreakerState;
  readonly failureCount: number;
  readonly successCount: number;
  readonly lastFailureAt?: Date;
  readonly lastStateChangeAt: Date;
}

export interface VerificationResult {
  readonly decision: 'accept' | 'reject' | 'review';
  readonly stages: readonly VerificationStageResult[];
  readonly rejectingStage?: string;
  readonly flaggingStages: readonly string[];
  readonly totalDurationMs: number;
}

export interface VerificationStageResult {
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly details?: Record<string, unknown>;
  readonly flags?: readonly string[];
}

export interface BaseEvent {
  readonly timestamp: Date;
  readonly correlationId: CorrelationId;
  readonly runId: RunId;
}

export type RuntimeEvent =
  | (BaseEvent & { readonly type: 'agent.started'; readonly agentId: AgentId; readonly stepId: StepId })
  | (BaseEvent & { readonly type: 'agent.completed'; readonly agentId: AgentId; readonly stepId: StepId; readonly durationMs: number; readonly tokenUsage: { prompt: number; completion: number } })
  | (BaseEvent & { readonly type: 'agent.failed'; readonly agentId: AgentId; readonly stepId: StepId; readonly error: string })
  | (BaseEvent & { readonly type: 'tool.invoked'; readonly toolName: string; readonly stepId: StepId; readonly input: Record<string, unknown> })
  | (BaseEvent & { readonly type: 'tool.completed'; readonly toolName: string; readonly stepId: StepId; readonly durationMs: number; readonly success: boolean })
  | (BaseEvent & { readonly type: 'tool.failed'; readonly toolName: string; readonly stepId: StepId; readonly error: string })
  | (BaseEvent & { readonly type: 'workflow.started'; readonly workflowId: WorkflowId })
  | (BaseEvent & { readonly type: 'workflow.completed'; readonly workflowId: WorkflowId; readonly durationMs: number; readonly stepsCompleted: number })
  | (BaseEvent & { readonly type: 'workflow.failed'; readonly workflowId: WorkflowId; readonly error: string; readonly failedStepId?: StepId })
  | (BaseEvent & { readonly type: 'state.transition'; readonly fromState: string; readonly toState: string; readonly trigger: string });
