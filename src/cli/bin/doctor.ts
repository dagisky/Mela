import { doctorUsage, parseCliArgs } from '../CliArgs.js';
import { createCliConfig } from '../CliConfig.js';
import { toCliError } from '../CliError.js';
import { runDoctorCommand, hasDoctorErrors } from '../DoctorCommand.js';
import { ExitCodes } from '../ExitCodes.js';
import { loadDotEnv } from '../DotEnvLoader.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.version) {
    console.log('0.1.0');
    return;
  }
  if (args.help) {
    console.log(doctorUsage());
    return;
  }
  await loadDotEnv(args.envPath ?? '.env');
  const config = createCliConfig(args);
  const diagnostics = await runDoctorCommand(config);
  if (config.outputMode === 'json') {
    console.log(JSON.stringify({ diagnostics }));
  } else {
    for (const diagnostic of diagnostics) {
      console.log(`${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  process.exitCode = hasDoctorErrors(diagnostics) ? ExitCodes.Failure : ExitCodes.Success;
}

main().catch((error) => {
  const cliError = toCliError(error);
  console.error(`${cliError.errorCode}: ${cliError.message}`);
  process.exitCode = ExitCodes.Failure;
});

