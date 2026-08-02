import { DEFAULT_CLI_CONFIG, type CliConfig } from './CliConfig.js';
import { CliError } from './CliError.js';

export interface ParsedCliArgs extends Partial<CliConfig> {
  readonly help: boolean;
  readonly version: boolean;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const args = [...argv];
  const parsed: Record<string, unknown> = { help: false, version: false };
  const promptParts: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--version' || arg === '-v' || arg === '-V') parsed.version = true;
    else if (arg === '--agent') parsed.agentId = requiredValue(args, arg);
    else if (arg === '--storage') parsed.storagePath = requiredValue(args, arg);
    else if (arg === '--provider') parsed.provider = requiredValue(args, arg);
    else if (arg === '--model') parsed.model = requiredValue(args, arg);
    else if (arg === '--cwd') parsed.cwd = requiredValue(args, arg);
    else if (arg === '--env') parsed.envPath = requiredValue(args, arg);
    else if (arg === '--tools') parsed.toolsPath = requiredValue(args, arg);
    else if (arg === '--json') parsed.outputMode = 'json';
    else if (arg === '--ndjson') parsed.outputMode = 'ndjson';
    else if (arg === '--debug') parsed.debug = true;
    else if (arg === '--no-color') parsed.noColor = true;
    else if (arg.startsWith('--')) throw new CliError('unknown_argument', `Unknown option: ${arg}`);
    else promptParts.push(arg);
  }

  if (promptParts.length > 0) parsed.prompt = promptParts.join(' ').trim();
  if (parsed.outputMode && !['text', 'json', 'ndjson'].includes(parsed.outputMode as string)) {
    throw new CliError('invalid_output_mode', `Invalid output mode: ${String(parsed.outputMode)}`);
  }
  return parsed as unknown as ParsedCliArgs;
}

export function chatUsage(): string {
  return `Usage:
  yarn chat -- [options] "prompt"

Options:
  --agent <id>       Agent id, default ${DEFAULT_CLI_CONFIG.agentId}
  --storage <dir>    Runtime persistence directory, default ${DEFAULT_CLI_CONFIG.storagePath}
  --provider <name>  mock | openai | nvidia, default ${DEFAULT_CLI_CONFIG.provider}
  --model <id>       Model id, default: agent's declared model, else the provider's own model list (<PROVIDER>_MODELS), else ${DEFAULT_CLI_CONFIG.model}
  --cwd <dir>        Working directory, default process cwd
  --env <path>       Env file, default .env
  --tools <dir>      Tool implementation directory, default ${DEFAULT_CLI_CONFIG.toolsPath}
  --json             Print final result as JSON
  --ndjson           Stream events and final result as NDJSON
  --debug            Include debug metadata
  --no-color         Disable color
  --help             Show help`;
}

export function consoleUsage(): string {
  return `Usage:
  yarn console -- [options]

Options:
  --agent <id>       Agent id, default ${DEFAULT_CLI_CONFIG.agentId}
  --storage <dir>    Runtime persistence directory, default ${DEFAULT_CLI_CONFIG.storagePath}
  --provider <name>  mock | openai | nvidia, default ${DEFAULT_CLI_CONFIG.provider}
  --model <id>       Model id, default: agent's declared model, else the provider's own model list (<PROVIDER>_MODELS), else ${DEFAULT_CLI_CONFIG.model}
  --cwd <dir>        Working directory, default process cwd
  --env <path>       Env file, default .env
  --tools <dir>      Tool implementation directory, default ${DEFAULT_CLI_CONFIG.toolsPath}
  --help             Show help`;
}

export function doctorUsage(): string {
  return `Usage:
  yarn doctor -- [options]

Options:
  --agent <id>       Agent id to validate, default ${DEFAULT_CLI_CONFIG.agentId}
  --storage <dir>    Runtime persistence directory, default ${DEFAULT_CLI_CONFIG.storagePath}
  --provider <name>  mock | openai | nvidia, default ${DEFAULT_CLI_CONFIG.provider}
  --cwd <dir>        Working directory, default process cwd
  --env <path>       Env file, default .env
  --tools <dir>      Tool implementation directory, default ${DEFAULT_CLI_CONFIG.toolsPath}
  --json             Print diagnostics as JSON
  --help             Show help`;
}

function requiredValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new CliError('missing_argument_value', `Missing value for ${flag}`);
  return value;
}
