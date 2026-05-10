import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RuntimeTool } from './RuntimeTool.js';

export interface ToolModuleRef {
  readonly id: string;
  readonly path: string;
}

type TypeScriptModule = typeof import('typescript');

interface ToolModuleShape {
  readonly default?: unknown;
  readonly tool?: unknown;
  readonly tools?: unknown;
}

export class LocalToolModuleProvider {
  constructor(private readonly rootDir: string) {}

  async loadAll(): Promise<readonly RuntimeTool[]> {
    const refs = await this.list();
    const tools = await Promise.all(refs.map((ref) => this.load(ref)));
    return tools.flat();
  }

  async load(refOrId: ToolModuleRef | string): Promise<readonly RuntimeTool[]> {
    const ref = typeof refOrId === 'string' ? this.refFor(refOrId) : refOrId;
    const module = await this.importModule(ref.path);
    return this.extractTools(module, ref);
  }

  async list(): Promise<readonly ToolModuleRef[]> {
    const files = await readdir(this.rootDir).catch(() => []);
    return files
      .filter((file) => isToolModuleFile(file))
      .map((file) => ({ id: moduleId(file), path: path.join(this.rootDir, file) }));
  }

  private refFor(toolId: string): ToolModuleRef {
    return { id: toolId, path: path.join(this.rootDir, `${toolId}.ts`) };
  }

  private async importModule(modulePath: string): Promise<ToolModuleShape> {
    if (modulePath.endsWith('.ts')) return this.importTypeScriptModule(modulePath);
    return import(pathToFileURL(modulePath).href) as Promise<ToolModuleShape>;
  }

  private async importTypeScriptModule(modulePath: string): Promise<ToolModuleShape> {
    const ts = await loadTypeScript();
    const source = await readFile(modulePath, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        verbatimModuleSyntax: true,
      },
      fileName: modulePath,
    });
    const encoded = Buffer.from(`${output.outputText}\n//# sourceURL=${pathToFileURL(modulePath).href}`).toString('base64');
    return import(`data:text/javascript;base64,${encoded}`) as Promise<ToolModuleShape>;
  }

  private extractTools(module: ToolModuleShape, ref: ToolModuleRef): readonly RuntimeTool[] {
    const exported = module.tools ?? module.tool ?? module.default;
    const candidates = Array.isArray(exported) ? exported : [exported];
    const tools = candidates.filter(isRuntimeTool);
    if (tools.length === 0) {
      throw new Error(`Tool module "${ref.path}" must export a RuntimeTool as default, tool, or tools.`);
    }
    return tools;
  }
}

function isToolModuleFile(file: string): boolean {
  return !file.endsWith('.d.ts') && /\.(ts|js|mjs|cjs)$/.test(file);
}

function moduleId(file: string): string {
  return file.replace(/\.(ts|js|mjs|cjs)$/, '');
}

function isRuntimeTool(value: unknown): value is RuntimeTool {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RuntimeTool>;
  return typeof candidate.name === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.timeoutMs === 'number'
    && typeof candidate.validateInput === 'function'
    && typeof candidate.checkPermissions === 'function'
    && typeof candidate.execute === 'function'
    && typeof candidate.mapResultToModel === 'function';
}

async function loadTypeScript(): Promise<TypeScriptModule> {
  try {
    return await import('typescript');
  } catch (error) {
    throw new Error(
      `Loading .ts tool modules requires the "typescript" package to be available. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
