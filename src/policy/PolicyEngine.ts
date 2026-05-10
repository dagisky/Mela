import type { RunContext } from '../types/index.js';
import type { RuntimeTool } from '../tools/RuntimeTool.js';

export type PermissionDecision =
  | { readonly decision: 'allow'; readonly reasonCode?: string }
  | { readonly decision: 'deny'; readonly reasonCode: string }
  | { readonly decision: 'require_approval'; readonly reasonCode: string };

export interface PolicyEngineConfig {
  readonly deniedTools?: readonly string[];
  readonly approvalRequiredTools?: readonly string[];
}

export class PolicyEngine {
  private readonly deniedTools: ReadonlySet<string>;
  private readonly approvalRequiredTools: ReadonlySet<string>;

  constructor(config: PolicyEngineConfig = {}) {
    this.deniedTools = new Set(config.deniedTools ?? []);
    this.approvalRequiredTools = new Set(config.approvalRequiredTools ?? []);
  }

  async checkTool(tool: RuntimeTool, _input: unknown, context: RunContext): Promise<PermissionDecision> {
    const hardDenied = (context.permissionContext as { hardDenyTools?: readonly string[] } | undefined)?.hardDenyTools ?? [];
    if (hardDenied.includes(tool.name) || this.deniedTools.has(tool.name)) {
      return { decision: 'deny', reasonCode: 'tool_policy_denied' };
    }
    if (this.approvalRequiredTools.has(tool.name)) {
      return { decision: 'require_approval', reasonCode: 'tool_requires_approval' };
    }
    return { decision: 'allow' };
  }
}

