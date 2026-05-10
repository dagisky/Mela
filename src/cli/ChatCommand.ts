import type { CliConfig } from './CliConfig.js';
import type { ConsoleRenderer } from './ConsoleRenderer.js';
import { ConsoleRuntimeFactory } from './ConsoleRuntimeFactory.js';
import { ConsoleSession } from './ConsoleSession.js';
import { ExitCodes, type ExitCode } from './ExitCodes.js';

export async function runChatCommand(
  config: CliConfig,
  renderer: ConsoleRenderer,
  runtimeFactory = new ConsoleRuntimeFactory(),
): Promise<ExitCode> {
  if (!config.prompt) {
    throw new Error('Prompt is required.');
  }
  const session = new ConsoleSession(config, runtimeFactory, renderer);
  const result = await session.submitPrompt(config.prompt);
  renderer.renderTerminalResult(result);
  if (result.status === 'success') return ExitCodes.Success;
  if (result.status === 'cancelled') return ExitCodes.Cancelled;
  return ExitCodes.Failure;
}

