import { chatUsage, parseCliArgs } from '../CliArgs.js';
import { createCliConfig } from '../CliConfig.js';
import { toCliError } from '../CliError.js';
import { createRenderer } from '../RendererFactory.js';
import { runChatCommand } from '../ChatCommand.js';
import { ExitCodes } from '../ExitCodes.js';
import { loadDotEnv } from '../DotEnvLoader.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.version) {
    console.log('0.1.0');
    return;
  }
  if (args.help || !args.prompt) {
    console.log(chatUsage());
    process.exitCode = args.help ? ExitCodes.Success : ExitCodes.Failure;
    return;
  }
  await loadDotEnv(args.envPath ?? '.env');
  const config = createCliConfig(args);
  process.exitCode = await runChatCommand(config, createRenderer(config));
}

main().catch((error) => {
  const cliError = toCliError(error);
  console.error(`${cliError.errorCode}: ${cliError.message}`);
  process.exitCode = ExitCodes.Failure;
});

