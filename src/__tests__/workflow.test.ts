import { describe, it, expect } from 'vitest';
import { executeWorkflow, type WorkflowEngineConfig } from '../workflows/WorkflowEngine.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { EventBus } from '../observability/EventBus.js';
import { createMockLLMClient, type LLMResponse } from '../models/LLMClient.js';
import { createLogger } from '../types/index.js';
import type { AgentDefinition, AgentId, WorkflowId, StepId, ProjectId, UserId } from '../types/index.js';
import { createDefaultToolResultMapper, type RuntimeTool } from '../tools/RuntimeTool.js';

const logger = createLogger({ serviceName: 'test', logLevel: 'silent', environment: 'test' });

const mockAgentDef: AgentDefinition = {
  id: 'test-agent' as AgentId,
  name: 'Test Agent',
  description: 'A test agent',
  category: 'specialized',
  version: '1.0',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 1024, temperature: 0.0 },
  systemPrompt: 'You are a test agent. Respond with a brief answer.',
  tools: [],
  outputSchema: {},
  reactConfig: { maxIterations: 3, confidenceThreshold: 0.8, stagnationWindow: 2, detectRepetition: true, confidenceDeclineWindow: 2 },
  contextConfig: { maxTokens: 10000, retrievalStrategy: 'synthesis-broad', includeEvidence: false, includeConflicts: false, includeGaps: false, includeDiscoveries: false },
  escalation: { confidenceFloor: 0.5, requireHumanReview: false },
  limits: { maxExecutionTimeMs: 10000, maxLLMCalls: 5, maxToolCalls: 10, maxOutputSizeBytes: 10000, maxContextTokens: 50000 },
  executionModes: ['interactive' as any],
  metadata: {},
};

const mockLLMResponse: LLMResponse = {
  content: 'This is the agent response based on the provided context.',
  toolCalls: [],
  finishReason: 'stop',
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  model: 'claude-sonnet-4-20250514',
};

describe('Workflow Engine', () => {
  it('executes a single-step workflow', async () => {
    const agentRegistry = new AgentRegistry(logger);
    agentRegistry.register(mockAgentDef);

    const toolRegistry = new RuntimeToolRegistry();
    const eventBus = new EventBus(logger);
    const llmClient = createMockLLMClient([mockLLMResponse]);

    const config: WorkflowEngineConfig = {
      agentRegistry,
      toolRegistry,
      llmClient,
      eventBus,
      logger,
    };

    const controller = new AbortController();
    const result = await executeWorkflow(config, {
      workflowDefinition: {
        id: 'test-wf' as WorkflowId,
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0',
        steps: [
          { type: 'agent', id: 'step-1' as StepId, agentId: 'test-agent' as AgentId },
        ],
      },
      projectId: 'proj-1' as ProjectId,
      userId: 'user-1' as UserId,
      userMessage: 'What are the key findings?',
      signal: controller.signal,
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]!.status).toBe('completed');
    expect(result.stepResults[0]!.output).toContain('agent response');
  });

  it('handles agent failure gracefully', async () => {
    const agentRegistry = new AgentRegistry(logger);
    agentRegistry.register(mockAgentDef);

    const toolRegistry = new RuntimeToolRegistry();
    const eventBus = new EventBus(logger);
    const llmClient = createMockLLMClient([]); // Empty queue → will throw

    const config: WorkflowEngineConfig = {
      agentRegistry,
      toolRegistry,
      llmClient,
      eventBus,
      logger,
    };

    const controller = new AbortController();
    const result = await executeWorkflow(config, {
      workflowDefinition: {
        id: 'test-wf' as WorkflowId,
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0',
        steps: [
          { type: 'agent', id: 'step-1' as StepId, agentId: 'test-agent' as AgentId },
        ],
      },
      projectId: 'proj-1' as ProjectId,
      userId: 'user-1' as UserId,
      userMessage: 'Test',
      signal: controller.signal,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('emits workflow lifecycle events', async () => {
    const agentRegistry = new AgentRegistry(logger);
    agentRegistry.register(mockAgentDef);

    const toolRegistry = new RuntimeToolRegistry();
    const eventBus = new EventBus(logger);
    const llmClient = createMockLLMClient([mockLLMResponse]);

    const events: string[] = [];
    eventBus.onAll((event) => { events.push(event.type); });

    const config: WorkflowEngineConfig = {
      agentRegistry,
      toolRegistry,
      llmClient,
      eventBus,
      logger,
    };

    const controller = new AbortController();
    await executeWorkflow(config, {
      workflowDefinition: {
        id: 'test-wf' as WorkflowId,
        name: 'Test Workflow',
        description: 'Test',
        version: '1.0',
        steps: [
          { type: 'agent', id: 'step-1' as StepId, agentId: 'test-agent' as AgentId },
        ],
      },
      projectId: 'proj-1' as ProjectId,
      userId: 'user-1' as UserId,
      userMessage: 'Test',
      signal: controller.signal,
    });

    expect(events).toContain('workflow.started');
    expect(events).toContain('agent.started');
    expect(events).toContain('agent.completed');
    expect(events).toContain('workflow.completed');
  });

  it('supports conditional branches and emits state transitions', async () => {
    const agentRegistry = new AgentRegistry(logger);
    const eventBus = new EventBus(logger);
    const events: string[] = [];
    eventBus.onAll((event) => { events.push(event.type); });
    const toolRegistry = new RuntimeToolRegistry([tool('truthy', { ok: true }), tool('branch', { path: 'true' })]);

    const result = await executeWorkflow({
      agentRegistry,
      toolRegistry,
      eventBus,
      llmClient: createMockLLMClient([]),
      logger,
      conditionEvaluator: (condition) => condition === 'always_true',
    }, {
      workflowDefinition: {
        id: 'conditional-wf' as WorkflowId,
        name: 'Conditional',
        description: 'Conditional test',
        version: '1.0',
        steps: [
          { type: 'tool', id: 'step-1' as StepId, toolName: 'truthy', input: {} },
          {
            type: 'conditional',
            id: 'step-2' as StepId,
            condition: 'always_true',
            ifTrue: { type: 'tool', id: 'step-true' as StepId, toolName: 'branch', input: {} },
          },
        ],
      },
      projectId: 'proj-1' as ProjectId,
      userId: 'user-1' as UserId,
      userMessage: 'Test',
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(2);
    expect(events).toContain('state.transition');
    expect(events).toContain('tool.completed');
  });

  it('supports parallel majority joins and sub-workflows', async () => {
    const agentRegistry = new AgentRegistry(logger);
    const eventBus = new EventBus(logger);
    const toolRegistry = new RuntimeToolRegistry([
      tool('pass-a', { value: 'a' }),
      tool('pass-b', { value: 'b' }),
      tool('fail-c', { value: 'c' }, false),
      tool('sub-tool', { value: 'sub' }),
    ]);

    const result = await executeWorkflow({
      agentRegistry,
      toolRegistry,
      eventBus,
      llmClient: createMockLLMClient([]),
      logger,
      workflowProvider: {
        load: async () => ({
          id: 'sub-wf' as WorkflowId,
          name: 'Sub',
          description: 'Sub workflow',
          version: '1.0',
          steps: [{ type: 'tool', id: 'sub-step' as StepId, toolName: 'sub-tool', input: {} }],
        }),
      },
    }, {
      workflowDefinition: {
        id: 'parent-wf' as WorkflowId,
        name: 'Parent',
        description: 'Parent workflow',
        version: '1.0',
        steps: [
          {
            type: 'parallel',
            id: 'parallel-step' as StepId,
            joinStrategy: 'wait_majority',
            branches: [
              { type: 'tool', id: 'a' as StepId, toolName: 'pass-a', input: {} },
              { type: 'tool', id: 'b' as StepId, toolName: 'pass-b', input: {} },
              { type: 'tool', id: 'c' as StepId, toolName: 'fail-c', input: {} },
            ],
          },
          { type: 'sub_workflow', id: 'sub' as StepId, workflowId: 'sub-wf' as WorkflowId },
        ],
      },
      projectId: 'proj-1' as ProjectId,
      userId: 'user-1' as UserId,
      userMessage: 'Test',
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults[0]?.status).toBe('completed');
    expect(result.stepResults[1]?.status).toBe('completed');
  });
});

function tool(name: string, output: unknown, ok = true): RuntimeTool<Record<string, unknown>, unknown> {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
    timeoutMs: 100,
    validateInput(input) {
      return { ok: true, value: input as Record<string, unknown> };
    },
    checkPermissions: async () => ({ decision: 'allow' }),
    execute: async () => ok ? { ok: true, output } : { ok: false, message: 'failed', errorCode: 'failed' },
    mapResultToModel: createDefaultToolResultMapper(),
  };
}
