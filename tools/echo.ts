const echoTool = {
  name: 'echo',
  description: 'Echo local inputs for CLI smoke tests.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Text to echo back.',
      },
    },
    additionalProperties: true,
  },
  timeoutMs: 5000,
  concurrencySafe: true,
  validateInput(input: unknown) {
    if (!input || typeof input !== 'object') return { ok: false, message: 'Tool input must be an object.' };
    return { ok: true, value: input as Record<string, unknown> };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: Record<string, unknown>) {
    return { ok: true as const, output: { ok: true, input } };
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
      content: JSON.stringify({ ok: true, output: result.output }),
    };
  },
};

export default echoTool;
