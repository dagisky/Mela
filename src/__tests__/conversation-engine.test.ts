import { describe, expect, it } from 'vitest';
import { ExecutionMode, type AgentDefinition, type AgentId } from '../types/index.js';
import { ConversationEngine } from '../runtime/ConversationEngine.js';
import { InMemoryStore } from '../persistence/InMemoryStore.js';
import { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { createDefaultToolResultMapper, type RuntimeTool } from '../tools/RuntimeTool.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../models/LLMClient.js';
import { createMockLLMClient } from '../models/LLMClient.js';
import { ContextBudgetManager } from '../context/ContextBudgetManager.js';
import { ChildRunManager } from '../agents/ChildRunManager.js';
import { createRunContext } from '../runtime/RunContext.js';
import { InteractiveApprovalManager } from '../human/InteractiveApprovalManager.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1' as AgentId,
    name: 'Agent One',
    description: 'Test agent',
    category: 'specialized',
    version: '1.0.0',
    model: { provider: 'anthropic', model: 'test-model', maxTokens: 1000, temperature: 0 },
    systemPrompt: 'You are a test agent.',
    tools: ['echo'],
    outputSchema: {},
    reactConfig: { maxIterations: 3, confidenceThreshold: 0.5, stagnationWindow: 2, detectRepetition: false, confidenceDeclineWindow: 2 },
    contextConfig: { maxTokens: 1000, retrievalStrategy: 'none', includeEvidence: false, includeConflicts: false, includeGaps: false, includeDiscoveries: false },
    escalation: { confidenceFloor: 0.5, requireHumanReview: false },
    limits: { maxExecutionTimeMs: 1000, maxLLMCalls: 3, maxToolCalls: 3, maxOutputSizeBytes: 10000, maxContextTokens: 10000 },
    executionModes: [ExecutionMode.Interactive],
    metadata: {},
    ...overrides,
  };
}

function response(overrides: Partial<LLMResponse>): LLMResponse {
  return {
    content: 'done',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'test-model',
    ...overrides,
  };
}

function echoTool(): RuntimeTool<Record<string, unknown>, Record<string, unknown>> {
  return {
    name: 'echo',
    description: 'Echo input',
    inputSchema: { type: 'object' },
    timeoutMs: 1000,
    validateInput(input) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, message: 'input must be an object' };
      }
      return { ok: true, value: input as Record<string, unknown> };
    },
    checkPermissions: async () => ({ decision: 'allow' }),
    execute: async (input) => ({ ok: true, output: input }),
    mapResultToModel: createDefaultToolResultMapper(),
  };
}

describe('ConversationEngine', () => {
  it('runs a model-only conversation and persists terminal state', async () => {
    const store = new InMemoryStore();
    const engine = new ConversationEngine({
      llmClient: createMockLLMClient([response({ content: 'hello' })]),
      toolRegistry: new RuntimeToolRegistry(),
      store,
    });

    const result = await engine.submit({
      agentDefinition: agent({ tools: [] }),
      userMessage: 'hi',
      sessionId: 'session-1',
    });
    const session = await store.loadSession('session-1');

    expect(result.status).toBe('success');
    expect(result.message).toBe('hello');
    expect(session.messages.map((message) => (message as { role: string }).role)).toEqual(['user', 'assistant']);
    expect(session.events.map((event) => event.type)).toContain('run.completed');
  });

  it('includes caller-provided history before the current user message', async () => {
    let observedMessages: LLMRequest['messages'] = [];
    const client: LLMClient = {
      async call(request) {
        observedMessages = [...request.messages];
        return response({ content: 'again' });
      },
      async *stream() {},
    };
    const engine = new ConversationEngine({
      llmClient: client,
      toolRegistry: new RuntimeToolRegistry(),
    });

    await engine.submit({
      agentDefinition: agent({ tools: [] }),
      userMessage: 'explain that again',
      history: [
        { role: 'user', content: 'tell me about thermodynamics' },
        { role: 'assistant', content: 'Thermodynamics studies heat, work, and energy.' },
      ],
    });

    expect(observedMessages.map((message) => message.content)).toEqual([
      'You are a test agent.',
      'tell me about thermodynamics',
      'Thermodynamics studies heat, work, and energy.',
      'explain that again',
    ]);
  });

  it('executes every model tool call and feeds results back to the model', async () => {
    const store = new InMemoryStore();
    const engine = new ConversationEngine({
      llmClient: createMockLLMClient([
        response({
          content: '',
          toolCalls: [{ id: 'tool-1', name: 'echo', arguments: JSON.stringify({ value: 42 }) }],
          finishReason: 'tool_calls',
        }),
        response({ content: 'observed' }),
      ]),
      toolRegistry: new RuntimeToolRegistry([echoTool()]),
      store,
    });

    const result = await engine.submit({
      agentDefinition: agent(),
      userMessage: 'use a tool',
      sessionId: 'session-1',
    });

    expect(result.status).toBe('success');
    expect(store.loadToolCalls(result.runId)).toHaveLength(1);
    expect((await store.loadSession('session-1')).messages.map((message) => (message as { role: string }).role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('fails closed when context budget is exceeded', async () => {
    const engine = new ConversationEngine({
      llmClient: createMockLLMClient([response({})]),
      toolRegistry: new RuntimeToolRegistry(),
      contextBudgetManager: new ContextBudgetManager(1),
    });

    const result = await engine.submit({
      agentDefinition: agent({ tools: [] }),
      userMessage: 'this message is intentionally too large',
    });

    expect(result.status).toBe('max_context_budget');
    expect(result.errorCode).toBe('budget_exceeded');
  });

  it('returns terminal model errors instead of rejecting', async () => {
    const engine = new ConversationEngine({
      llmClient: {
        call: async () => { throw new Error('provider unavailable'); },
        stream: async function* () { yield { type: 'error', error: new Error('provider unavailable') }; },
      },
      toolRegistry: new RuntimeToolRegistry(),
    });

    const result = await engine.submit({
      agentDefinition: agent({ tools: [] }),
      userMessage: 'hi',
    });

    expect(result.status).toBe('model_error_retry_exhausted');
    expect(result.errorCode).toBe('model_error');
    expect(result.message).toBe('provider unavailable');
  });

  it('supports interactive approval pause and resume', async () => {
    const approvalManager = new InteractiveApprovalManager();
    const engine = new ConversationEngine({
      llmClient: createMockLLMClient([
        response({
          content: '',
          toolCalls: [{ id: 'tool-1', name: 'echo', arguments: JSON.stringify({ value: 1 }) }],
          finishReason: 'tool_calls',
        }),
        response({ content: 'approved' }),
      ]),
      toolRegistry: new RuntimeToolRegistry([echoTool()]),
      policyEngine: new PolicyEngine({ approvalRequiredTools: ['echo'] }),
      approvalManager,
    });

    const run = engine.submit({ agentDefinition: agent(), userMessage: 'approve tool' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(approvalManager.getPendingApproval()?.status).toBe('pending');
    approvalManager.approve();
    await expect(run).resolves.toMatchObject({ status: 'success', message: 'approved' });
  });
});

describe('ChildRunManager', () => {
  it('runs child agents in the parent session', async () => {
    const store = new InMemoryStore();
    const conversationEngine = new ConversationEngine({
      llmClient: createMockLLMClient([response({ content: 'child done' })]),
      toolRegistry: new RuntimeToolRegistry(),
      store,
    });
    const manager = new ChildRunManager({
      conversationEngine,
      store,
      agentProvider: { load: async () => agent({ tools: [], id: 'child-agent' as AgentId }) },
    });

    const result = await manager.runChild(
      createRunContext({ runId: 'parent-run', sessionId: 'session-1' }),
      { agentId: 'child-agent', taskPrompt: 'work' },
    );

    expect(result.status).toBe('success');
    expect(result.sessionId).toBe('session-1');
    expect((await store.loadSession('session-1')).events.map((event) => event.type)).toContain('child_run.completed');
  });
});
