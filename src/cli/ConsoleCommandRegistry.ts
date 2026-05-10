import type { ConsoleCommand } from './ConsoleCommand.js';

export class ConsoleCommandRegistry {
  private readonly commands = new Map<string, ConsoleCommand>();

  constructor(commands: readonly ConsoleCommand[] = []) {
    for (const command of commands) this.register(command);
  }

  register(command: ConsoleCommand): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases ?? []) this.commands.set(alias, command);
  }

  resolve(name: string): ConsoleCommand | undefined {
    return this.commands.get(name);
  }

  list(): readonly ConsoleCommand[] {
    return [...new Set(this.commands.values())].sort((a, b) => a.name.localeCompare(b.name));
  }
}

