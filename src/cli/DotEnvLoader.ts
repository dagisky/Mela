import { readFile } from 'node:fs/promises';

export interface DotEnvLoadResult {
  readonly loaded: boolean;
  readonly path: string;
  readonly keys: readonly string[];
}

export async function loadDotEnv(filePath = '.env', env: NodeJS.ProcessEnv = process.env): Promise<DotEnvLoadResult> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { loaded: false, path: filePath, keys: [] };
    throw error;
  }

  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
      keys.push(parsed.key);
    }
  }
  return { loaded: true, path: filePath, keys };
}

function parseDotEnvLine(line: string): { readonly key: string; readonly value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const equalIndex = trimmed.indexOf('=');
  if (equalIndex <= 0) return undefined;
  const key = trimmed.slice(0, equalIndex).trim();
  let value = trimmed.slice(equalIndex + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

