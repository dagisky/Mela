import { ExecutionMode, type AgentDefinition } from '../types/index.js';
import { isRecord, validateAgentFrontmatter } from './DefinitionSchemas.js';
import { parseFrontmatter, parseMarkdownSections } from './MarkdownFrontmatter.js';

export interface AgentManifestModel {
  readonly provider?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface AgentManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly skills: readonly string[];
  readonly toolPolicy: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  readonly model?: AgentManifestModel;
  readonly rawMarkdown?: string;
}

export class AgentDefinitionLoader {
  loadMarkdown(markdown: string, source = 'inline'): AgentDefinition {
    const manifest = this.loadManifest(markdown, source);
    return manifestToAgentDefinition(manifest);
  }

  loadManifest(markdown: string, source = 'inline'): AgentManifest {
    const { data, body } = parseFrontmatter(markdown);
    const validation = validateAgentFrontmatter(data);
    if (!validation.ok) {
      throw new Error(`Invalid agent definition ${source}: ${validation.errors.join('; ')}`);
    }
    const sections = parseMarkdownSections(body);
    const tools = isRecord(data.tools) ? data.tools : {};
    return {
      id: stringValue(data.id, 'default'),
      name: stringValue(data.name, stringValue(data.id, 'Default Agent')),
      version: stringValue(data.version, '1.0.0'),
      description: stringValue(data.description, 'Runtime agent'),
      systemPrompt: buildSystemPrompt(sections, body),
      skills: stringArray(data.skills),
      toolPolicy: {
        allow: stringArray(tools.allow),
        deny: stringArray(tools.deny),
      },
      model: parseModel(data.model),
      rawMarkdown: body,
    };
  }
}

function parseModel(value: unknown): AgentManifestModel | undefined {
  if (!isRecord(value)) return undefined;
  return {
    provider: typeof value.provider === 'string' ? value.provider : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    maxTokens: typeof value.maxTokens === 'number' ? value.maxTokens : undefined,
    temperature: typeof value.temperature === 'number' ? value.temperature : undefined,
  };
}

export function manifestToAgentDefinition(manifest: AgentManifest): AgentDefinition {
  return {
    id: manifest.id as AgentDefinition['id'],
    name: manifest.name,
    description: manifest.description,
    category: 'utility',
    version: manifest.version,
    model: {
      provider: manifest.model?.provider ?? 'openai',
      model: manifest.model?.model ?? 'gpt-5.4-mini',
      maxTokens: manifest.model?.maxTokens ?? 2048,
      temperature: manifest.model?.temperature ?? 0.2,
    },
    systemPrompt: manifest.systemPrompt,
    tools: manifest.toolPolicy.allow,
    outputSchema: {},
    reactConfig: {
      maxIterations: 8,
      confidenceThreshold: 0.7,
      stagnationWindow: 2,
      detectRepetition: true,
      confidenceDeclineWindow: 2,
    },
    contextConfig: {
      maxTokens: 100_000,
      retrievalStrategy: 'none',
      includeEvidence: false,
      includeConflicts: false,
      includeGaps: false,
      includeDiscoveries: false,
    },
    escalation: {
      confidenceFloor: 0.5,
      requireHumanReview: false,
    },
    limits: {
      maxExecutionTimeMs: 120_000,
      maxLLMCalls: 20,
      maxToolCalls: 20,
      maxOutputSizeBytes: 200_000,
      maxContextTokens: 100_000,
    },
    executionModes: [ExecutionMode.Interactive],
    metadata: {
      skillIds: manifest.skills.join(','),
      deniedToolNames: manifest.toolPolicy.deny.join(','),
    },
  };
}

function buildSystemPrompt(sections: Record<string, string>, body: string): string {
  const parts = [
    sections.role,
    sections.workflow ? `Workflow:\n${sections.workflow}` : undefined,
    sections.output_contract ? `Output Contract:\n${sections.output_contract}` : undefined,
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length > 0 ? parts.join('\n\n') : body.trim();
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

