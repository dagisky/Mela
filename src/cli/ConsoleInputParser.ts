import type { ConsoleCommandInput } from './ConsoleCommand.js';

export type ParsedConsoleInput =
  | { readonly type: 'empty' }
  | { readonly type: 'prompt'; readonly text: string }
  | { readonly type: 'command'; readonly command: ConsoleCommandInput };

export function parseConsoleInput(line: string): ParsedConsoleInput {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'empty' };
  if (!trimmed.startsWith('/')) return { type: 'prompt', text: trimmed };
  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts.shift() ?? '';
  return { type: 'command', command: { name, args: parts, raw: trimmed } };
}

