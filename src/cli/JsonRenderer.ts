import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type { ConsoleBannerInput } from './ConsoleRenderer.js';
import { BaseRenderer, type RendererStreams } from './ConsoleRenderer.js';
import type { ConsoleCommandResult } from './ConsoleCommand.js';
import type { CliError } from './CliError.js';

export class JsonRenderer extends BaseRenderer {
  private readonly events: RuntimeEventRecord[] = [];

  constructor(streams: RendererStreams = {}) {
    super(streams);
  }

  renderBanner(_input: ConsoleBannerInput): void {}

  renderEvent(event: RuntimeEventRecord): void {
    this.events.push(event);
  }

  renderCommandResult(result: ConsoleCommandResult): void {
    this.writeJson({ type: 'command_result', result });
  }

  renderTerminalResult(result: TerminalResult): void {
    this.writeJson({ type: 'terminal_result', result, events: this.events });
  }

  renderError(error: CliError): void {
    this.writeJson({ type: 'error', errorCode: error.errorCode, message: error.message, data: error.data });
  }

  private writeJson(value: unknown): void {
    this.write(JSON.stringify(value));
  }
}

