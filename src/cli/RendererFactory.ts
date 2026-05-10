import type { CliConfig } from './CliConfig.js';
import type { ConsoleRenderer } from './ConsoleRenderer.js';
import { JsonRenderer } from './JsonRenderer.js';
import { NdjsonRenderer } from './NdjsonRenderer.js';
import { TextRenderer } from './TextRenderer.js';

export function createRenderer(config: CliConfig): ConsoleRenderer {
  if (config.outputMode === 'json') return new JsonRenderer();
  if (config.outputMode === 'ndjson') return new NdjsonRenderer();
  return new TextRenderer();
}

