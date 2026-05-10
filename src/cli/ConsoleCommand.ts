import type { ConsoleSession } from './ConsoleSession.js';

export interface ConsoleCommandInput {
  readonly name: string;
  readonly args: readonly string[];
  readonly raw: string;
}

export type ConsoleCommandResult =
  | { readonly status: 'success'; readonly message?: string; readonly data?: unknown }
  | { readonly status: 'error'; readonly message: string; readonly errorCode: string; readonly data?: unknown }
  | { readonly status: 'exit'; readonly message?: string };

export interface ConsoleCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly usage: string;
  readonly allowedWhileRunning?: boolean;
  readonly allowedWhileApprovalWaiting?: boolean;
  execute(input: ConsoleCommandInput, session: ConsoleSession): Promise<ConsoleCommandResult>;
}

