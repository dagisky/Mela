import { randomUUID } from 'node:crypto';
import type { TerminalResult } from '../types/index.js';
import type { LLMMessage } from '../models/LLMClient.js';
import { ConsoleModes, type ConsoleMode } from './ConsoleMode.js';
import { ConsoleCommandQueue } from './ConsoleCommandQueue.js';
import { ConsoleHistory } from './ConsoleHistory.js';
import type { CliConfig } from './CliConfig.js';
import type { ConsoleRuntime, ConsoleRuntimeFactory } from './ConsoleRuntimeFactory.js';
import type { ConsoleRenderer } from './ConsoleRenderer.js';

export class ConsoleSession {
  readonly sessionId: string;
  readonly queue = new ConsoleCommandQueue();
  readonly history = new ConsoleHistory();
  private readonly transcript: LLMMessage[] = [];
  mode: ConsoleMode = ConsoleModes.Ready;
  runtime?: ConsoleRuntime;
  lastTerminalResult?: TerminalResult;
  private activeController?: AbortController;

  constructor(
    readonly config: CliConfig,
    private readonly runtimeFactory: ConsoleRuntimeFactory,
    private readonly renderer: ConsoleRenderer,
    sessionId = `session_${randomUUID()}`,
  ) {
    this.sessionId = sessionId;
  }

  async initialize(): Promise<void> {
    if (this.runtime) return;
    this.runtime = await this.runtimeFactory.createRuntime(this.config);
    this.runtime.eventBus.onAll((event) => {
      if ('runId' in event && 'correlationId' in event) {
        this.renderer.renderEvent(event as never);
      }
    });
  }

  async submitPrompt(text: string): Promise<TerminalResult> {
    await this.initialize();
    if (!this.runtime) throw new Error('Runtime was not initialized.');
    const controller = new AbortController();
    this.activeController = controller;
    this.mode = ConsoleModes.AgentRunning;
    this.history.add('user', text);
    try {
      const agent = await this.runtimeFactory.loadAgent({ ...this.config, prompt: text }, this.runtime);
      const result = await this.runtime.conversationEngine.submit({
        agentDefinition: agent,
        userMessage: text,
        history: this.transcript,
        sessionId: this.sessionId,
        signal: controller.signal,
        permissionContext: { mode: 'read-only' },
      });
      this.lastTerminalResult = result;
      this.transcript.push({ role: 'user', content: text });
      this.transcript.push({ role: 'assistant', content: result.message, toolCalls: [] });
      this.history.add('assistant', result.message);
      return result;
    } finally {
      this.activeController = undefined;
      this.mode = ConsoleModes.Ready;
    }
  }

  enqueuePrompt(text: string): void {
    this.queue.enqueue(text);
  }

  cancelActiveRun(): boolean {
    if (!this.activeController) return false;
    this.activeController.abort('user_cancelled');
    return true;
  }

  getStatus(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      agentId: this.config.agentId,
      provider: this.config.provider,
      model: this.config.model,
      storagePath: this.config.storagePath,
      cwd: this.config.cwd,
      mode: this.mode,
      queueLength: this.queue.length,
      transcriptMessages: this.transcript.length,
      lastTerminalStatus: this.lastTerminalResult?.status,
      tools: this.runtime?.toolRegistry.names() ?? [],
    };
  }
}
