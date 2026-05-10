import { ConsoleModes } from './ConsoleMode.js';
import type { ConsoleCommandInput, ConsoleCommandResult } from './ConsoleCommand.js';
import type { ConsoleCommandRegistry } from './ConsoleCommandRegistry.js';
import type { ConsoleSession } from './ConsoleSession.js';

export class ConsoleCommandBus {
  constructor(private readonly registry: ConsoleCommandRegistry) {}

  async dispatch(input: ConsoleCommandInput, session: ConsoleSession): Promise<ConsoleCommandResult> {
    const command = this.registry.resolve(input.name);
    if (!command) {
      return { status: 'error', errorCode: 'unknown_command', message: `Unknown command: /${input.name}` };
    }
    if (session.mode === ConsoleModes.AgentRunning && !command.allowedWhileRunning) {
      return { status: 'error', errorCode: 'command_not_allowed', message: `/${input.name} cannot run while an agent is active.` };
    }
    if (session.mode === ConsoleModes.ApprovalWaiting && !command.allowedWhileApprovalWaiting) {
      return { status: 'error', errorCode: 'command_not_allowed', message: `/${input.name} cannot run while approval is pending.` };
    }
    return command.execute(input, session);
  }
}

