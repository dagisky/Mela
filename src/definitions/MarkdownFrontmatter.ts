function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, '');
}

export interface ParsedMarkdownDefinition {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

export function parseFrontmatter(markdown: string): ParsedMarkdownDefinition {
  if (!markdown.startsWith('---')) {
    return { data: {}, body: markdown };
  }
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) throw new Error('Frontmatter is not closed.');

  const yaml = markdown.slice(3, end).trim();
  const body = markdown.slice(end + 4).trimStart();
  const data: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  const stack: { indent: number; value: Record<string, unknown> | unknown[] }[] = [{ indent: -1, value: data }];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index] ?? '';
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();

    if (line.startsWith('- ')) {
      while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
      const parent = stack.at(-1)?.value;
      if (!Array.isArray(parent)) throw new Error(`List item without list parent: ${line}`);
      parent.push(parseScalar(line.slice(2)));
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) throw new Error(`Invalid frontmatter line: ${line}`);
    const key = match[1]!.trim();
    const value = match[2]!;

    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const parent = stack.at(-1)?.value;
    if (!parent || Array.isArray(parent)) throw new Error(`Invalid parent for key: ${key}`);
    const next = lines.slice(index + 1).find((candidate) => candidate.trim() && !candidate.trim().startsWith('#'));
    const nextIndent = next !== undefined ? next.match(/^\s*/)?.[0].length ?? 0 : 0;
    const nextIsList = next !== undefined && nextIndent > indent && next.trim().startsWith('- ');

    parent[key] = value.trim() === '' ? (nextIsList ? [] : {}) : parseScalar(value);
    const child = parent[key];
    if ((typeof child === 'object' && child !== null) || Array.isArray(child)) {
      stack.push({ indent, value: child as Record<string, unknown> | unknown[] });
    }
  }

  return { data, body };
}

export function parseMarkdownSections(body: string): Record<string, string> {
  const sections: Record<string, string[]> = { raw: [] };
  let current = 'raw';
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#\s+(.+)$/);
    if (heading) {
      current = heading[1]!.trim().toLowerCase().replace(/\s+/g, '_');
      sections[current] = [];
    } else {
      sections[current]!.push(line);
    }
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()]),
  );
}
