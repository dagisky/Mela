import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type { ConsoleBannerInput } from './ConsoleRenderer.js';
import type { ConsoleRenderer } from './ConsoleRenderer.js';
import type { ConsoleCommandResult } from './ConsoleCommand.js';
import type { CliError } from './CliError.js';

export class SilentRenderer implements ConsoleRenderer {
  readonly events: RuntimeEventRecord[] = [];
  readonly commandResults: ConsoleCommandResult[] = [];
  readonly terminalResults: TerminalResult[] = [];
  readonly errors: CliError[] = [];

  renderBanner(_input: ConsoleBannerInput): void {}
  renderEvent(event: RuntimeEventRecord): void { this.events.push(event); }
  renderCommandResult(result: ConsoleCommandResult): void { this.commandResults.push(result); }
  renderTerminalResult(result: TerminalResult): void { this.terminalResults.push(result); }
  renderError(error: CliError): void { this.errors.push(error); }
}

