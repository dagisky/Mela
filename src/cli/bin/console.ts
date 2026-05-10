import { consoleUsage, parseCliArgs } from '../CliArgs.js';
import { createCliConfig } from '../CliConfig.js';
import { toCliError } from '../CliError.js';
import { ConsoleApp } from '../ConsoleApp.js';
import { ExitCodes } from '../ExitCodes.js';
import { loadDotEnv } from '../DotEnvLoader.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.version) {
    console.log('0.1.0');
    return;
  }
  if (args.help) {
    console.log(consoleUsage());
    return;
  }
  await loadDotEnv(args.envPath ?? '.env');
  await new ConsoleApp({ config: createCliConfig(args) }).start();
}

main().catch((error) => {
  const cliError = toCliError(error);
  console.error(`${cliError.errorCode}: ${cliError.message}`);
  process.exitCode = ExitCodes.Failure;
});

