import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type { ConsoleCommandResult } from './ConsoleCommand.js';
import type { CliError } from './CliError.js';

export interface ConsoleBannerInput {
  readonly version: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly storagePath: string;
  readonly provider: string;
  readonly model: string;
  readonly cwd: string;
}

export interface ConsoleRenderer {
  renderBanner(input: ConsoleBannerInput): void;
  renderEvent(event: RuntimeEventRecord): void;
  renderCommandResult(result: ConsoleCommandResult): void;
  renderTerminalResult(result: TerminalResult): void;
  renderError(error: CliError): void;
}

export interface RendererStreams {
  readonly stdout?: Pick<NodeJS.WriteStream, 'write'>;
  readonly stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export abstract class BaseRenderer implements ConsoleRenderer {
  protected readonly stdout: Pick<NodeJS.WriteStream, 'write'>;
  protected readonly stderr: Pick<NodeJS.WriteStream, 'write'>;

  constructor(streams: RendererStreams = {}) {
    this.stdout = streams.stdout ?? process.stdout;
    this.stderr = streams.stderr ?? process.stderr;
  }

  abstract renderBanner(input: ConsoleBannerInput): void;
  abstract renderEvent(event: RuntimeEventRecord): void;
  abstract renderCommandResult(result: ConsoleCommandResult): void;
  abstract renderTerminalResult(result: TerminalResult): void;
  abstract renderError(error: CliError): void;

  protected write(line = ''): void {
    this.stdout.write(`${line}\n`);
  }

  protected writeError(line = ''): void {
    this.stderr.write(`${line}\n`);
  }
}

