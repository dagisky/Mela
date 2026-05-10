import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type { ConsoleBannerInput } from './ConsoleRenderer.js';
import { BaseRenderer, type RendererStreams } from './ConsoleRenderer.js';
import type { ConsoleCommandResult } from './ConsoleCommand.js';
import type { CliError } from './CliError.js';

export class TextRenderer extends BaseRenderer {
  constructor(streams: RendererStreams = {}) {
    super(streams);
  }

  renderBanner(input: ConsoleBannerInput): void {
    this.write(`RIA Agentic Runtime`);
    this.write(`agent=${input.agentId} session=${input.sessionId}`);
    this.write(`provider=${input.provider} model=${input.model}`);
    this.write(`storage=${input.storagePath}`);
    this.write(`cwd=${input.cwd}`);
    this.write('');
  }

  renderEvent(event: RuntimeEventRecord): void {
    if (event.type === 'model.request.started') this.write('[model] thinking...');
    else if (event.type === 'model.request.completed') return;
    else if (event.type.includes('model.request')) this.write(`[model] ${event.type}`);
    else if (event.type === 'tool.call.started' || event.type === 'tool.call.completed') {
      this.write(`[tool] ${activityText(event) ?? event.type}`);
    } else if (event.type.includes('tool.call')) this.write(`[tool] ${event.type}`);
    else if (event.type.includes('approval')) this.write(`[approval] ${event.type}`);
    else if (event.type.includes('run.')) this.write(`[run] ${event.type}`);
  }

  renderCommandResult(result: ConsoleCommandResult): void {
    if (result.message) {
      const output = result.status === 'error' ? this.writeError.bind(this) : this.write.bind(this);
      output(result.message);
    }
    if ('data' in result && result.data !== undefined) this.write(formatData(result.data));
  }

  renderTerminalResult(result: TerminalResult): void {
    this.write(result.message);
    if (result.status !== 'success') this.writeError(`status=${result.status}${result.errorCode ? ` error=${result.errorCode}` : ''}`);
  }

  renderError(error: CliError): void {
    this.writeError(`${error.errorCode}: ${error.message}`);
  }
}

function activityText(event: RuntimeEventRecord): string | undefined {
  const activity = event.payload.activity;
  return typeof activity === 'string' && activity.length > 0 ? activity : undefined;
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}
