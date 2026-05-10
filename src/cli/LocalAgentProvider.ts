import path from 'node:path';
import type { AgentDefinition } from '../types/index.js';
import {
  LocalAgentDefinitionProvider,
  LocalSkillDefinitionProvider,
} from '../definitions/LocalDefinitionProvider.js';
import { LocalToolModuleProvider } from '../tools/LocalToolModuleProvider.js';
import type { AgentManifest } from '../definitions/AgentDefinitionLoader.js';
import type { SkillDefinition } from '../definitions/SkillDefinitionLoader.js';
import type { CliDiagnostic } from './CliConfig.js';
import { CliError } from './CliError.js';

export class LocalAgentProvider {
  private readonly markdownProvider: LocalAgentDefinitionProvider;
  private readonly skillProvider: LocalSkillDefinitionProvider;
  private readonly toolProvider: LocalToolModuleProvider;

  constructor(
    private readonly agentsDir: string,
    skillsDir = path.resolve(path.dirname(agentsDir), 'skills'),
    toolsDir = path.resolve(path.dirname(agentsDir), 'tools'),
  ) {
    this.markdownProvider = new LocalAgentDefinitionProvider(agentsDir);
    this.skillProvider = new LocalSkillDefinitionProvider(skillsDir);
    this.toolProvider = new LocalToolModuleProvider(toolsDir);
  }

  async load(agentId: string): Promise<AgentDefinition> {
    try {
      return await this.markdownProvider.load(agentId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CliError('agent_not_found', `Agent "${agentId}" was not found at ${path.join(this.agentsDir, `${agentId}.md`)}.`);
      }
      throw new CliError('agent_load_failed', `Could not load agent "${agentId}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadManifest(agentId: string): Promise<AgentManifest | undefined> {
    try {
      return await this.markdownProvider.loadManifest(agentId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async loadSkillsForAgent(agentId: string): Promise<readonly SkillDefinition[]> {
    const manifest = await this.loadManifest(agentId);
    if (!manifest) return [];
    const skills: SkillDefinition[] = [];
    for (const skillId of manifest.skills) {
      skills.push(await this.skillProvider.load(skillId));
    }
    return skills;
  }

  async listAgents(): Promise<readonly { readonly id: string; readonly path: string }[]> {
    return this.markdownProvider.list();
  }

  async listSkills(): Promise<readonly { readonly id: string; readonly path: string }[]> {
    return this.skillProvider.list();
  }

  async validate(agentId: string): Promise<readonly CliDiagnostic[]> {
    try {
      const agent = await this.load(agentId);
      const diagnostics: CliDiagnostic[] = [
        { level: 'info', code: 'agent_loaded', message: `Agent "${agentId}" loaded successfully.` },
      ];
      const manifest = await this.loadManifest(agentId);
      if (manifest) {
        const toolRefs = (await this.toolProvider.loadAll()).map((tool) => tool.name);
        for (const toolName of manifest.toolPolicy.allow) {
          if (!toolRefs.includes(toolName)) {
            diagnostics.push({ level: 'warning', code: 'tool_module_missing', message: `Agent allows tool "${toolName}", but no matching tool module was found.` });
          }
        }
        for (const skillId of manifest.skills) {
          try {
            await this.skillProvider.load(skillId);
            diagnostics.push({ level: 'info', code: 'skill_loaded', message: `Skill "${skillId}" loaded successfully.` });
          } catch (error) {
            diagnostics.push({
              level: 'error',
              code: 'skill_load_failed',
              message: `Could not load skill "${skillId}": ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
      if (agent.tools.length === 0) {
        diagnostics.push({ level: 'info', code: 'agent_has_no_tools', message: `Agent "${agentId}" allows no tools.` });
      }
      return diagnostics;
    } catch (error) {
      return [{
        level: 'error',
        code: error instanceof CliError ? error.errorCode : 'agent_validation_failed',
        message: error instanceof Error ? error.message : String(error),
      }];
    }
  }
}
