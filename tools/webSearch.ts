const webSearchTool = {
  name: 'web_search',
  description: 'Search the public web for math literature, definitions, documentation, and current source links.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to run on the public web.',
      },
      max_results: {
        type: 'integer',
        description: 'Maximum number of search results to return, from 1 to 10.',
      },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional domain allow-list. If set, only these domains are returned.',
      },
      blocked_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional domain block-list. These domains are excluded.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  timeoutMs: 15000,
  maxResultSizeBytes: 24000,
  concurrencySafe: true,
  display: {
    name: 'Web Search',
    activity(input: SearchInput) {
      return `Searching web for "${input.query}"`;
    },
    result(output: { results?: readonly unknown[] }) {
      return `Web search found ${output.results?.length ?? 0} result(s)`;
    },
  },
  validateInput(input: unknown) {
    if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
    if (typeof input.query !== 'string' || input.query.trim().length < 2) {
      return { ok: false, message: 'query must contain at least 2 characters.' };
    }
    const maxResults = input.max_results === undefined ? 5 : Number(input.max_results);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
      return { ok: false, message: 'max_results must be an integer from 1 to 10.' };
    }
    const allowedDomains = stringList(input.allowed_domains, 'allowed_domains');
    if (!allowedDomains.ok) return allowedDomains;
    const blockedDomains = stringList(input.blocked_domains, 'blocked_domains');
    if (!blockedDomains.ok) return blockedDomains;
    if (allowedDomains.value.length > 0 && blockedDomains.value.length > 0) {
      return { ok: false, message: 'Use either allowed_domains or blocked_domains, not both.' };
    }
    return {
      ok: true,
      value: {
        query: input.query.trim(),
        maxResults,
        allowedDomains: allowedDomains.value.map(normalizeDomain),
        blockedDomains: blockedDomains.value.map(normalizeDomain),
      },
    };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: SearchInput) {
    const startedAt = Date.now();
    const url = new URL('https://duckduckgo.com/html/');
    url.searchParams.set('q', input.query);

    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RIA-MathResearchAgent/1.0',
      },
    });
    if (!response.ok) {
      return { ok: false as const, errorCode: 'web_search_failed', message: `Search request returned ${response.status}.` };
    }

    const html = await response.text();
    const parsed = parseDuckDuckGoResults(html)
      .filter((result) => domainAllowed(result.url, input.allowedDomains, input.blockedDomains))
      .slice(0, input.maxResults);

    return {
      ok: true as const,
      output: {
        query: input.query,
        results: parsed,
        durationMs: Date.now() - startedAt,
        source: 'duckduckgo-html',
        reminder: 'Use returned URLs as leads. Read important sources with web_read before citing them as evidence.',
      },
    };
  },
  mapResultToModel(result: { ok: boolean; output?: unknown; errorCode?: string; message?: string }, toolCallId: string) {
    if (!result.ok) {
      return {
        toolCallId,
        content: JSON.stringify({ ok: false, errorCode: result.errorCode, message: result.message }),
        isError: true,
        errorCode: result.errorCode,
      };
    }
    return {
      toolCallId,
      content: `${JSON.stringify({ ok: true, output: result.output })}\n\nREMINDER: Include source URLs in research notes only after checking relevant pages with web_read.`,
    };
  },
};

interface SearchInput {
  readonly query: string;
  readonly maxResults: number;
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
}

interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly domain: string;
}

function parseDuckDuckGoResults(html: string): readonly SearchResult[] {
  const results: SearchResult[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;
  for (const match of html.matchAll(resultPattern)) {
    const url = decodeDuckDuckGoUrl(decodeHtml(match[1] ?? ''));
    const parsedUrl = parseHttpUrl(url);
    if (!parsedUrl) continue;
    results.push({
      title: cleanHtml(match[2] ?? ''),
      url: parsedUrl.href,
      snippet: cleanHtml(match[3] ?? match[4] ?? ''),
      domain: parsedUrl.hostname,
    });
  }
  return dedupeByUrl(results);
}

function decodeDuckDuckGoUrl(value: string): string {
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : url.href;
  } catch {
    return value;
  }
}

function domainAllowed(url: string, allowedDomains: readonly string[], blockedDomains: readonly string[]): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  const domain = normalizeDomain(parsed.hostname);
  if (allowedDomains.length > 0 && !allowedDomains.some((allowed) => domainMatches(domain, allowed))) return false;
  return !blockedDomains.some((blocked) => domainMatches(domain, blocked));
}

function domainMatches(hostname: string, rule: string): boolean {
  return hostname === rule || hostname.endsWith(`.${rule}`);
}

function dedupeByUrl(results: readonly SearchResult[]): readonly SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function stringList(value: unknown, name: string): { ok: true; value: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return { ok: false, message: `${name} must be a list of domain strings.` };
  }
  return { ok: true, value };
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function cleanHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default webSearchTool;
