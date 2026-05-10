export class CliError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function toCliError(error: unknown, fallbackCode = 'cli_error'): CliError {
  if (error instanceof CliError) return error;
  return new CliError(fallbackCode, error instanceof Error ? error.message : String(error));
}

