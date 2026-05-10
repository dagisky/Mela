export interface ConsoleHistoryEntry {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: Date;
}

export class ConsoleHistory {
  private readonly entries: ConsoleHistoryEntry[] = [];

  add(role: ConsoleHistoryEntry['role'], content: string): void {
    this.entries.push({ role, content, timestamp: new Date() });
  }

  clear(): void {
    this.entries.length = 0;
  }

  list(): readonly ConsoleHistoryEntry[] {
    return [...this.entries];
  }
}

