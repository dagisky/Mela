const webReadTool = {
  name: 'web_read',
  description: 'Read a public web page and return compact plain text for citation or context checks.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'HTTP or HTTPS URL to read.',
      },
      max_chars: {
        type: 'integer',
        description: 'Maximum number of text characters to return, from 500 to 12000.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  timeoutMs: 15000,
  maxResultSizeBytes: 16000,
  concurrencySafe: true,
  display: {
    name: 'Web Read',
    activity(input: { url: string }) {
      return `Reading ${input.url}`;
    },
    result(output: { title?: string; url?: string }) {
      return `Read ${output.title ?? output.url ?? 'web page'}`;
    },
  },
  validateInput(input: unknown) {
    if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
    if (typeof input.url !== 'string') return { ok: false, message: 'url is required.' };
    const url = parseHttpUrl(input.url);
    if (!url) return { ok: false, message: 'url must be a valid http or https URL.' };
    const maxChars = input.max_chars === undefined ? 6000 : Number(input.max_chars);
    if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 12000) {
      return { ok: false, message: 'max_chars must be an integer from 500 to 12000.' };
    }
    return { ok: true, value: { url: url.href, maxChars } };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: { url: string; maxChars: number }) {
    const response = await fetch(input.url, {
      headers: {
        accept: 'text/html,text/plain,application/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'Mela-MathResearchAgent/1.0',
      },
    });
    if (!response.ok) {
      return { ok: false as const, errorCode: 'web_read_failed', message: `Request returned ${response.status}.` };
    }
    const raw = await response.text();
    const text = toPlainText(raw).slice(0, input.maxChars);
    return {
      ok: true as const,
      output: {
        url: input.url,
        title: title(raw),
        text,
        truncated: text.length >= input.maxChars,
      },
    };
  },
  mapResultToModel: mapResultToModel,
};

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function toPlainText(raw: string): string {
  return decodeHtml(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function title(raw: string): string | undefined {
  const value = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? decodeHtml(value).replace(/\s+/g, ' ').trim() : undefined;
}

function decodeHtml(value: string): string {
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

export default webReadTool;
