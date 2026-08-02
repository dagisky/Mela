import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Interface } from 'node:readline/promises';
import type { CliConfig } from './CliConfig.js';
import type { ConsoleRenderer } from './ConsoleRenderer.js';
import { TextRenderer } from './TextRenderer.js';
import { ConsoleRuntimeFactory } from './ConsoleRuntimeFactory.js';
import { ConsoleSession } from './ConsoleSession.js';
import { ConsoleCommandBus } from './ConsoleCommandBus.js';
import { createDefaultCommandRegistry } from './commands/defaultCommands.js';
import { parseConsoleInput } from './ConsoleInputParser.js';
import { ConsoleModes } from './ConsoleMode.js';

export interface ConsoleAppOptions {
  readonly config: CliConfig;
  readonly runtimeFactory?: ConsoleRuntimeFactory;
  readonly renderer?: ConsoleRenderer;
  readonly readlineFactory?: () => Interface;
}

export class ConsoleApp {
  private readonly renderer: ConsoleRenderer;
  private readonly session: ConsoleSession;
  private readonly bus = new ConsoleCommandBus(createDefaultCommandRegistry());

  constructor(private readonly options: ConsoleAppOptions) {
    this.renderer = options.renderer ?? new TextRenderer();
    const runtimeFactory = options.runtimeFactory ?? new ConsoleRuntimeFactory();
    this.session = new ConsoleSession(options.config, runtimeFactory, this.renderer);
  }

  async handleLine(line: string): Promise<void> {
    const parsed = parseConsoleInput(line);
    if (parsed.type === 'empty') return;
    if (parsed.type === 'command') {
      const result = await this.bus.dispatch(parsed.command, this.session);
      this.renderer.renderCommandResult(result);
      return;
    }
    if (this.session.mode === ConsoleModes.AgentRunning) {
      this.session.enqueuePrompt(parsed.text);
      this.renderer.renderCommandResult({ status: 'success', message: 'Prompt queued.' });
      return;
    }
    const result = await this.session.submitPrompt(parsed.text);
    this.renderer.renderTerminalResult(result);
  }

  async start(): Promise<void> {
    await this.session.initialize();
    this.renderer.renderBanner({
      version: '0.1.0',
      agentId: this.session.config.agentId,
      sessionId: this.session.sessionId,
      storagePath: this.session.config.storagePath,
      provider: this.session.config.provider,
      model: this.session.config.model,
      cwd: this.session.config.cwd,
    });
    const rl = this.options.readlineFactory?.() ?? createInterface({ input, output, prompt: 'mela> ' });
    rl.on('SIGINT', () => {
      if (this.session.mode === ConsoleModes.AgentRunning && this.session.cancelActiveRun()) {
        this.renderer.renderCommandResult({ status: 'success', message: 'Cancellation requested.' });
        return;
      }
      this.session.mode = ConsoleModes.Exiting;
      rl.close();
    });

    try {
      rl.prompt();
      for await (const line of rl) {
        await this.handleLine(line);
        if (this.session.mode === ConsoleModes.Exiting) break;
        rl.prompt();
      }
    } finally {
      rl.close();
    }
  }
}

