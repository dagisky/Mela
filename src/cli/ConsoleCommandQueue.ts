export interface QueuedPrompt {
  readonly text: string;
  readonly queuedAt: Date;
}

export class ConsoleCommandQueue {
  private readonly items: QueuedPrompt[] = [];

  enqueue(text: string): void {
    this.items.push({ text, queuedAt: new Date() });
  }

  dequeue(): QueuedPrompt | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
  }

  get length(): number {
    return this.items.length;
  }

  list(): readonly QueuedPrompt[] {
    return [...this.items];
  }
}

