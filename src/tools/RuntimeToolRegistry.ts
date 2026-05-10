import type { RuntimeTool } from './RuntimeTool.js';

export class RuntimeToolRegistry {
  private readonly tools = new Map<string, RuntimeTool>();

  constructor(tools: readonly RuntimeTool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: RuntimeTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): RuntimeTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly RuntimeTool[] {
    return Array.from(this.tools.values());
  }

  names(): readonly string[] {
    return Array.from(this.tools.keys());
  }

  resolveAllowed(allow: readonly string[] = [], deny: readonly string[] = []): readonly string[] {
    const denied = new Set(deny);
    return allow.filter((name) => this.tools.has(name) && !denied.has(name));
  }
}

