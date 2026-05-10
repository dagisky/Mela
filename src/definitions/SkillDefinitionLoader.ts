import { parseFrontmatter, parseMarkdownSections } from './MarkdownFrontmatter.js';
import { validateSkillFrontmatter } from './DefinitionSchemas.js';

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedTools: readonly string[];
  readonly invocationMode: 'preload' | 'invoke' | 'both';
  readonly validators: readonly string[];
  readonly body: {
    readonly instructions: string;
    readonly examples?: string;
    readonly rawMarkdown: string;
  };
}

export class SkillDefinitionLoader {
  loadMarkdown(markdown: string, source = 'inline'): SkillDefinition {
    const { data, body } = parseFrontmatter(markdown);
    const validation = validateSkillFrontmatter(data);
    if (!validation.ok) {
      throw new Error(`Invalid skill definition ${source}: ${validation.errors.join('; ')}`);
    }
    const sections = parseMarkdownSections(body);
    return {
      id: stringValue(data.id, 'skill'),
      name: stringValue(data.name, stringValue(data.id, 'skill')),
      version: stringValue(data.version, '1.0.0'),
      description: stringValue(data.description, 'Runtime skill'),
      allowedTools: stringArray(data.allowed_tools),
      invocationMode: invocationMode(data.invocation_mode),
      validators: stringArray(data.validators),
      body: {
        instructions: sections.instructions ?? sections.purpose ?? body.trim(),
        examples: sections.examples ?? sections.example,
        rawMarkdown: body,
      },
    };
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function invocationMode(value: unknown): SkillDefinition['invocationMode'] {
  return value === 'invoke' || value === 'both' ? value : 'preload';
}

