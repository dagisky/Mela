import type { CliConfig, CliDiagnostic } from './CliConfig.js';
import { ConsoleRuntimeFactory } from './ConsoleRuntimeFactory.js';

export async function runDoctorCommand(
  config: CliConfig,
  runtimeFactory = new ConsoleRuntimeFactory(),
): Promise<readonly CliDiagnostic[]> {
  const diagnostics = [...await runtimeFactory.diagnose(config)];
  diagnostics.push(...secretDiagnostics());
  return diagnostics;
}

function secretDiagnostics(): readonly CliDiagnostic[] {
  return [{
    level: 'info',
    code: 'secret_redaction',
    message: 'Secrets are not printed by doctor diagnostics.',
  }];
}

export function hasDoctorErrors(diagnostics: readonly CliDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.level === 'error');
}

