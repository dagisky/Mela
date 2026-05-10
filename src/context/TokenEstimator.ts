export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTokens(value: unknown): number {
  if (typeof value === 'string') return estimateTextTokens(value);
  return estimateTextTokens(JSON.stringify(value ?? ''));
}
