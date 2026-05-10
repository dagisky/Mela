export interface BudgetedToolOutput {
  readonly output: unknown;
  readonly replaced: boolean;
  readonly sizeBytes: number;
}

export function budgetToolOutput(output: unknown, maxBytes: number): BudgetedToolOutput {
  const text = JSON.stringify(output);
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  if (sizeBytes <= maxBytes) {
    return { output, replaced: false, sizeBytes };
  }
  const preview = text.slice(0, Math.max(0, maxBytes - 200));
  return {
    output: {
      replaced: true,
      reason: 'tool_output_too_large',
      sizeBytes,
      preview,
    },
    replaced: true,
    sizeBytes,
  };
}

