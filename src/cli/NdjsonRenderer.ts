import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type { ConsoleBannerInput } from './ConsoleRenderer.js';
import { BaseRenderer, type RendererStreams } from './ConsoleRenderer.js';
import type { ConsoleCommandResult } from './ConsoleCommand.js';
import type { CliError } from './CliError.js';

export class NdjsonRenderer extends BaseRenderer {
  constructor(streams: RendererStreams = {}) {
    super(streams);
  }

  renderBanner(_input: ConsoleBannerInput): void {}

  renderEvent(event: RuntimeEventRecord): void {
    this.writeRecord({ type: 'event', event });
  }

  renderCommandResult(result: ConsoleCommandResult): void {
    this.writeRecord({ type: 'command_result', result });
  }

  renderTerminalResult(result: TerminalResult): void {
    this.writeRecord({ type: 'terminal_result', result });
  }

  renderError(error: CliError): void {
    this.writeRecord({ type: 'error', errorCode: error.errorCode, message: error.message, data: error.data });
  }

  private writeRecord(value: unknown): void {
    this.write(JSON.stringify(value));
  }
}

