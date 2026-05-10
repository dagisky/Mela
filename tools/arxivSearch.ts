const arxivSearchTool = {
  name: 'arxiv_search',
  description: 'Search arXiv for papers across any field and return compact metadata with abstracts.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query, such as a paper title, author, topic, theorem name, or arXiv id.',
      },
      max_results: {
        type: 'integer',
        description: 'Maximum number of papers to return, from 1 to 10.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  timeoutMs: 15000,
  maxResultSizeBytes: 16000,
  concurrencySafe: true,
  display: {
    name: 'arXiv Search',
    activity(input: { query: string }) {
      return `Searching arXiv for "${input.query}"`;
    },
    result(output: { results?: readonly unknown[] }) {
      return `arXiv search found ${output.results?.length ?? 0} paper(s)`;
    },
  },
  validateInput(input: unknown) {
    if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      return { ok: false, message: 'query is required.' };
    }
    const maxResults = input.max_results === undefined ? 5 : Number(input.max_results);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
      return { ok: false, message: 'max_results must be an integer from 1 to 10.' };
    }
    return { ok: true, value: { query: input.query.trim(), maxResults } };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: { query: string; maxResults: number }) {
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('search_query', `all:${input.query}`);
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(input.maxResults));
    url.searchParams.set('sortBy', 'relevance');
    url.searchParams.set('sortOrder', 'descending');

    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false as const, errorCode: 'arxiv_request_failed', message: `arXiv returned ${response.status}.` };
    }

    const xml = await response.text();
    return {
      ok: true as const,
      output: {
        query: input.query,
        results: parseArxivEntries(xml),
      },
    };
  },
  mapResultToModel: mapResultToModel,
};

function parseArxivEntries(xml: string) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1] ?? '';
    return {
      id: text(entry, 'id'),
      title: clean(text(entry, 'title')),
      summary: clean(text(entry, 'summary')),
      published: text(entry, 'published'),
      updated: text(entry, 'updated'),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((author) => clean(decodeXml(author[1] ?? ''))),
      categories: [...entry.matchAll(/<category term="([^"]+)"/g)].map((category) => category[1]),
      pdf: entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/)?.[1],
    };
  });
}

function text(source: string, tag: string): string {
  return decodeXml(source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? '');
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapResultToModel(result: { ok: boolean; output?: unknown; errorCode?: string; message?: string }, toolCallId: string) {
  if (!result.ok) {
    return {
      toolCallId,
      content: JSON.stringify({ ok: false, errorCode: result.errorCode, message: result.message }),
      isError: true,
      errorCode: result.errorCode,
    };
  }
  return { toolCallId, content: JSON.stringify({ ok: true, output: result.output }) };
}

export default arxivSearchTool;
