import type { AgentDefinition } from '../types/index.js';
import type { Logger } from '../types/index.js';

/**
 * Agent Registry — loads and stores agent definitions.
 *
 * Agents are data-defined (loaded from YAML/JSON at startup).
 * The registry is immutable after initialization — no hot-reloading.
 *
 * Key invariant: adding a new agent should NOT require kernel edits.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  constructor(private readonly logger: Logger) {}

  register(definition: AgentDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent "${definition.id}" is already registered`);
    }
    this.agents.set(definition.id, definition);
    this.logger.info('Agent registered', { agentId: definition.id, name: definition.name });
  }

  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  getOrThrow(agentId: string): AgentDefinition {
    const def = this.agents.get(agentId);
    if (!def) {
      throw new Error(`Agent "${agentId}" not found in registry`);
    }
    return def;
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  list(): readonly AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  get size(): number {
    return this.agents.size;
  }
}
