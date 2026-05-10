export const ExitCodes = {
  Success: 0,
  Failure: 1,
  Cancelled: 130,
} as const;

export type ExitCode = typeof ExitCodes[keyof typeof ExitCodes];

