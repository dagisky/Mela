export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateAgentFrontmatter(data: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const field of ['id', 'name']) {
    if (!data[field]) errors.push(`Missing required field: ${field}`);
  }
  const tools = data.tools;
  if (tools !== undefined && isRecord(tools)) {
    const allow = tools.allow;
    const deny = tools.deny;
    if (allow !== undefined && !Array.isArray(allow)) errors.push('tools.allow must be a list');
    if (deny !== undefined && !Array.isArray(deny)) errors.push('tools.deny must be a list');
    if (Array.isArray(allow) && Array.isArray(deny)) {
      const conflicts = deny.filter((tool) => allow.includes(tool));
      if (conflicts.length > 0) errors.push(`Tools cannot be both allowed and denied: ${conflicts.join(', ')}`);
    }
  }
  if (data.skills !== undefined && !Array.isArray(data.skills)) errors.push('skills must be a list');
  const model = data.model;
  if (model !== undefined) {
    if (!isRecord(model)) {
      errors.push('model must be an object');
    } else {
      if (model.provider !== undefined && typeof model.provider !== 'string') errors.push('model.provider must be a string');
      if (model.model !== undefined && typeof model.model !== 'string') errors.push('model.model must be a string');
      if (model.maxTokens !== undefined && typeof model.maxTokens !== 'number') errors.push('model.maxTokens must be a number');
      if (model.temperature !== undefined && typeof model.temperature !== 'number') errors.push('model.temperature must be a number');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateSkillFrontmatter(data: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const field of ['id', 'name']) {
    if (!data[field]) errors.push(`Missing required field: ${field}`);
  }
  if (data.invocation_mode && !['preload', 'invoke', 'both'].includes(String(data.invocation_mode))) {
    errors.push('invocation_mode must be preload, invoke, or both');
  }
  if (data.allowed_tools !== undefined && !Array.isArray(data.allowed_tools)) {
    errors.push('allowed_tools must be a list');
  }
  return { ok: errors.length === 0, errors };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

