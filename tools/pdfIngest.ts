import { createHash, randomUUID } from 'node:crypto';

const pdfIngestTool = {
  name: 'pdf_ingest',
  description: 'Download a public PDF URL, upload it to ingestion-ms, wait for parsing, and return the parsed document.',
  inputSchema: {
    type: 'object',
    properties: {
      pdf_url: {
        type: 'string',
        description: 'Public HTTP or HTTPS PDF URL, such as an arXiv PDF link.',
      },
      document_id: {
        type: 'string',
        description: 'Optional stable document id, 8-128 chars using letters, numbers, underscore, or dash.',
      },
      filename: {
        type: 'string',
        description: 'Optional filename to send to ingestion-ms.',
      },
      max_wait_ms: {
        type: 'integer',
        description: 'Maximum time to wait for parsing, from 5000 to 300000.',
      },
      poll_interval_ms: {
        type: 'integer',
        description: 'Polling interval while waiting for parsing, from 1000 to 30000.',
      },
      max_markdown_chars: {
        type: 'integer',
        description: 'Maximum parsed markdown characters to return, from 1000 to 50000.',
      },
    },
    required: ['pdf_url'],
    additionalProperties: false,
  },
  timeoutMs: 330000,
  maxResultSizeBytes: 80000,
  concurrencySafe: true,
  display: {
    name: 'PDF Ingest',
    activity(input: PdfIngestInput) {
      return `Ingesting PDF ${input.pdfUrl}`;
    },
    result(output: { documentId?: string; status?: string }) {
      return `PDF ingestion ${output.status ?? 'completed'}${output.documentId ? ` for ${output.documentId}` : ''}`;
    },
  },
  validateInput(input: unknown) {
    if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
    if (typeof input.pdf_url !== 'string') return { ok: false, message: 'pdf_url is required.' };
    const pdfUrl = parseHttpUrl(input.pdf_url);
    if (!pdfUrl) return { ok: false, message: 'pdf_url must be a valid http or https URL.' };
    const documentId = typeof input.document_id === 'string' && input.document_id.length > 0
      ? input.document_id
      : stableDocumentId(pdfUrl.href);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(documentId)) {
      return { ok: false, message: 'document_id must be 8-128 chars, [A-Za-z0-9_-].' };
    }
    if (input.filename !== undefined && typeof input.filename !== 'string') {
      return { ok: false, message: 'filename must be a string.' };
    }
    const maxWaitMs = numberInRange(input.max_wait_ms, 120000, 5000, 300000, 'max_wait_ms');
    if (!maxWaitMs.ok) return maxWaitMs;
    const pollIntervalMs = numberInRange(input.poll_interval_ms, 5000, 1000, 30000, 'poll_interval_ms');
    if (!pollIntervalMs.ok) return pollIntervalMs;
    const maxMarkdownChars = numberInRange(input.max_markdown_chars, 20000, 1000, 50000, 'max_markdown_chars');
    if (!maxMarkdownChars.ok) return maxMarkdownChars;
    return {
      ok: true,
      value: {
        pdfUrl: pdfUrl.href,
        documentId,
        filename: typeof input.filename === 'string' && input.filename.trim().length > 0
          ? input.filename.trim()
          : filenameFromUrl(pdfUrl),
        maxWaitMs: maxWaitMs.value,
        pollIntervalMs: pollIntervalMs.value,
        maxMarkdownChars: maxMarkdownChars.value,
      },
    };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: PdfIngestInput, context: ToolUseContext) {
    const baseUrl = ingestionBaseUrl();
    if (!baseUrl) {
      return {
        ok: false as const,
        errorCode: 'ingestion_base_url_missing',
        message: 'Set MELA_INGESTION_BASE_URL or INGESTION_MS_URL to the ingestion-ms base URL.',
      };
    }

    const pdf = await downloadPdf(input.pdfUrl, context.runContext.signal);
    if (!pdf.ok) return pdf;

    const init = await initUpload(baseUrl, {
      documentId: input.documentId,
      filename: input.filename,
      size: pdf.bytes.byteLength,
      signal: context.runContext.signal,
    });
    if (!init.ok) return init;

    const uploaded = await uploadToSignedUrl(init.output.uploadUrl, pdf.bytes, init.output.contentType, context.runContext.signal);
    if (!uploaded.ok) return uploaded;

    const status = await waitForProcessed(baseUrl, init.output.documentId, input.maxWaitMs, input.pollIntervalMs, context.runContext.signal);
    if (!status.ok) return status;

    const result = await getResult(baseUrl, init.output.documentId, input.maxMarkdownChars, context.runContext.signal);
    if (!result.ok) return result;

    return {
      ok: true as const,
      output: {
        documentId: init.output.documentId,
        status: result.output.status,
        parsedAt: result.output.parsedAt,
        sourcePdfUrl: input.pdfUrl,
        source: result.output.source,
        markdown: result.output.markdown,
        markdownTruncated: result.output.markdownTruncated,
        imageCount: result.output.imageCount,
        metadata: result.output.metadata,
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
    return { toolCallId, content: JSON.stringify({ ok: true, output: result.output }) };
  },
};

interface PdfIngestInput {
  readonly pdfUrl: string;
  readonly documentId: string;
  readonly filename: string;
  readonly maxWaitMs: number;
  readonly pollIntervalMs: number;
  readonly maxMarkdownChars: number;
}

interface ToolUseContext {
  readonly runContext: { readonly signal: AbortSignal };
}

interface InitUploadResponse {
  readonly documentId: string;
  readonly uploadUrl: string;
  readonly contentType: string;
}

function ingestionBaseUrl(): string | undefined {
  const value = process.env.MELA_INGESTION_BASE_URL ?? process.env.INGESTION_MS_URL;
  return value ? value.replace(/\/+$/, '') : undefined;
}

function authHeaders(): Record<string, string> {
  const token = process.env.MELA_INGESTION_BEARER_TOKEN ?? process.env.INGESTION_MS_BEARER_TOKEN;
  const apiKey = process.env.MELA_INGESTION_API_KEY ?? process.env.INGESTION_MS_API_KEY;
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

async function downloadPdf(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: { accept: 'application/pdf,*/*;q=0.1', 'user-agent': 'Mela-PdfIngestTool/1.0' },
    signal,
  });
  if (!response.ok) {
    return { ok: false as const, errorCode: 'pdf_download_failed', message: `PDF download returned ${response.status}.` };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('application/pdf') && !contentType.includes('octet-stream')) {
    return { ok: false as const, errorCode: 'pdf_content_type_invalid', message: `Expected PDF content but got "${contentType}".` };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false as const, errorCode: 'pdf_empty', message: 'Downloaded PDF is empty.' };
  }
  return { ok: true as const, bytes };
}

async function initUpload(baseUrl: string, input: { documentId: string; filename: string; size: number; signal: AbortSignal }) {
  const response = await fetch(`${baseUrl}/documents/init-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      filename: input.filename,
      contentType: 'application/pdf',
      size: input.size,
      documentId: input.documentId,
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    return { ok: false as const, errorCode: 'ingestion_init_failed', message: await responseMessage(response) };
  }
  return { ok: true as const, output: await response.json() as InitUploadResponse };
}

async function uploadToSignedUrl(uploadUrl: string, bytes: Uint8Array, contentType: string, signal: AbortSignal) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType || 'application/pdf' },
    body: bytes,
    signal,
  });
  if (!response.ok) {
    return { ok: false as const, errorCode: 'signed_upload_failed', message: await responseMessage(response) };
  }
  return { ok: true as const, output: { uploaded: true } };
}

async function waitForProcessed(
  baseUrl: string,
  documentId: string,
  maxWaitMs: number,
  pollIntervalMs: number,
  signal: AbortSignal,
) {
  const startedAt = Date.now();
  let lastStatus = 'UNKNOWN';
  while (Date.now() - startedAt <= maxWaitMs) {
    const response = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/status`, {
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      return { ok: false as const, errorCode: 'ingestion_status_failed', message: await responseMessage(response) };
    }
    const status = await response.json() as { status?: string; failureReason?: string | null };
    lastStatus = status.status ?? 'UNKNOWN';
    if (lastStatus === 'PROCESSED') return { ok: true as const, output: status };
    if (['FAILED', 'ERROR'].includes(lastStatus)) {
      return {
        ok: false as const,
        errorCode: 'ingestion_processing_failed',
        message: status.failureReason ?? `Ingestion failed with status ${lastStatus}.`,
      };
    }
    await sleep(pollIntervalMs, signal);
  }
  return {
    ok: false as const,
    errorCode: 'ingestion_timeout',
    message: `Timed out waiting for parsed document. Last status: ${lastStatus}.`,
  };
}

async function getResult(baseUrl: string, documentId: string, maxMarkdownChars: number, signal: AbortSignal) {
  const response = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/result`, {
    headers: authHeaders(),
    signal,
  });
  if (!response.ok) {
    return { ok: false as const, errorCode: 'ingestion_result_failed', message: await responseMessage(response) };
  }
  const body = await response.json() as {
    documentId: string;
    status: string;
    parsedAt: string | null;
    source: unknown;
    markdown: string;
    images?: readonly unknown[];
    metadata?: unknown;
  };
  return {
    ok: true as const,
    output: {
      documentId: body.documentId,
      status: body.status,
      parsedAt: body.parsedAt,
      source: body.source,
      markdown: body.markdown.slice(0, maxMarkdownChars),
      markdownTruncated: body.markdown.length > maxMarkdownChars,
      imageCount: body.images?.length ?? 0,
      metadata: body.metadata,
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('PDF ingestion cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function responseMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return body ? `${response.status}: ${body.slice(0, 1000)}` : `${response.status}: ${response.statusText}`;
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function stableDocumentId(url: string): string {
  return `pdf_${createHash('sha256').update(url).digest('hex').slice(0, 24)}` || randomUUID();
}

function filenameFromUrl(url: URL): string {
  const base = url.pathname.split('/').filter(Boolean).at(-1) ?? 'document.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number, name: string) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    return { ok: false as const, message: `${name} must be an integer from ${min} to ${max}.` };
  }
  return { ok: true as const, value: numeric };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default pdfIngestTool;
