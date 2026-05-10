export const ConsoleModes = {
  Ready: 'ready',
  AgentRunning: 'agent_running',
  ApprovalWaiting: 'approval_waiting',
  Queued: 'queued',
  Error: 'error',
  Exiting: 'exiting',
} as const;

export type ConsoleMode = typeof ConsoleModes[keyof typeof ConsoleModes];

