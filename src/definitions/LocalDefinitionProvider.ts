import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition } from '../types/index.js';
import { AgentDefinitionLoader, type AgentManifest } from './AgentDefinitionLoader.js';
import { SkillDefinitionLoader, type SkillDefinition } from './SkillDefinitionLoader.js';

export class LocalAgentDefinitionProvider {
  constructor(
    private readonly rootDir: string,
    private readonly loader = new AgentDefinitionLoader(),
  ) {}

  async load(agentId: string): Promise<AgentDefinition> {
    return this.loader.loadMarkdown(await this.read(agentId), this.pathFor(agentId));
  }

  async loadManifest(agentId: string): Promise<AgentManifest> {
    return this.loader.loadManifest(await this.read(agentId), this.pathFor(agentId));
  }

  async list(): Promise<readonly { readonly id: string; readonly path: string }[]> {
    const files = await readdir(this.rootDir).catch(() => []);
    return files
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({ id: path.basename(file, '.md'), path: path.join(this.rootDir, file) }));
  }

  private async read(agentId: string): Promise<string> {
    return readFile(this.pathFor(agentId), 'utf8');
  }

  private pathFor(agentId: string): string {
    return path.join(this.rootDir, `${agentId}.md`);
  }
}

export class LocalSkillDefinitionProvider {
  constructor(
    private readonly rootDir: string,
    private readonly loader = new SkillDefinitionLoader(),
  ) {}

  async load(skillId: string): Promise<SkillDefinition> {
    return this.loader.loadMarkdown(await readFile(this.pathFor(skillId), 'utf8'), this.pathFor(skillId));
  }

  async list(): Promise<readonly { readonly id: string; readonly path: string }[]> {
    const files = await readdir(this.rootDir).catch(() => []);
    return files
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({ id: path.basename(file, '.md'), path: path.join(this.rootDir, file) }));
  }

  private pathFor(skillId: string): string {
    return path.join(this.rootDir, `${skillId}.md`);
  }
}
