import path from 'node:path';
import { ConversationEngine } from '../runtime/ConversationEngine.js';
import { FileStore } from '../persistence/FileStore.js';
import { RuntimeToolRegistry } from '../tools/RuntimeToolRegistry.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';
import { InteractiveApprovalManager } from '../human/InteractiveApprovalManager.js';
import { EventBus } from '../observability/EventBus.js';
import { createLogger, type AgentDefinition } from '../types/index.js';
import type { ApprovalRequester } from '../human/ApprovalManager.js';
import type { LLMClient } from '../models/LLMClient.js';
import { createRoutingLLMClient } from '../models/LLMClient.js';
import type { PersistenceStore } from '../persistence/PersistenceStore.js';
import { DEFAULT_CLI_CONFIG, type CliConfig, type CliDiagnostic } from './CliConfig.js';
import { createDefaultModelProviders, resolveModelProvider, type CliModelProvider } from './CliModelProvider.js';
import { createCliModelClientRouter } from './ModelClientRouter.js';
import { EventedPersistenceStore } from './ConsoleRuntimeEventBridge.js';
import { LocalAgentProvider } from './LocalAgentProvider.js';
import { loadDotEnv } from './DotEnvLoader.js';
import { LocalToolModuleProvider } from '../tools/LocalToolModuleProvider.js';

export interface ConsoleRuntime {
  readonly conversationEngine: ConversationEngine;
  readonly store: PersistenceStore;
  readonly toolRegistry: RuntimeToolRegistry;
  readonly policyEngine: PolicyEngine;
  readonly approvalManager: InteractiveApprovalManager;
  readonly eventBus: EventBus;
  readonly agentProvider: LocalAgentProvider;
  readonly modelProviders: readonly CliModelProvider[];
}

export interface ConsoleRuntimeFactoryOverrides {
  readonly modelClient?: LLMClient;
  readonly store?: PersistenceStore;
  readonly toolRegistry?: RuntimeToolRegistry;
  readonly policyEngine?: PolicyEngine;
  readonly approvalManager?: ApprovalRequester;
  readonly agentProvider?: LocalAgentProvider;
  readonly modelProviders?: readonly CliModelProvider[];
}

export class ConsoleRuntimeFactory {
  constructor(private readonly overrides: ConsoleRuntimeFactoryOverrides = {}) {}

  async createRuntime(config: CliConfig): Promise<ConsoleRuntime> {
    await loadDotEnv(config.envPath);
    const providers = this.overrides.modelProviders ?? createDefaultModelProviders();
    const modelClient = this.overrides.modelClient ?? createRoutingLLMClient(createCliModelClientRouter(providers, config));
    const fileStore = this.overrides.store ?? new FileStore(path.resolve(config.cwd, config.storagePath));
    const eventBus = new EventBus(createLogger({ serviceName: 'mela-cli' }), { retainEvents: true });
    const store = new EventedPersistenceStore({ store: fileStore, eventBus });
    const toolRegistry = this.overrides.toolRegistry ?? await this.loadToolRegistry(config);
    const policyEngine = this.overrides.policyEngine ?? new PolicyEngine();
    const approvalManager = this.asInteractiveApprovalManager(this.overrides.approvalManager, store);
    const agentProvider = this.overrides.agentProvider ?? new LocalAgentProvider(
      path.resolve(config.cwd, 'agents'),
      path.resolve(config.cwd, 'skills'),
      this.resolveToolsPath(config),
    );
    const conversationEngine = new ConversationEngine({
      llmClient: modelClient,
      toolRegistry,
      store,
      policyEngine,
      approvalManager,
    });

    return {
      conversationEngine,
      store,
      toolRegistry,
      policyEngine,
      approvalManager,
      eventBus,
      agentProvider,
      modelProviders: providers,
    };
  }

  async diagnose(config: CliConfig): Promise<readonly CliDiagnostic[]> {
    await loadDotEnv(config.envPath);
    const diagnostics: CliDiagnostic[] = [
      { level: 'info', code: 'node_version', message: `Node ${process.version}` },
      { level: 'info', code: 'cwd', message: config.cwd },
    ];
    const providers = this.overrides.modelProviders ?? createDefaultModelProviders();
    try {
      const provider = resolveModelProvider(config.provider ?? DEFAULT_CLI_CONFIG.provider, providers);
      diagnostics.push(...provider.validateConfig(config));
    } catch (error) {
      diagnostics.push({ level: 'error', code: 'unknown_provider', message: error instanceof Error ? error.message : String(error) });
    }
    const agentProvider = this.overrides.agentProvider ?? new LocalAgentProvider(
      path.resolve(config.cwd, 'agents'),
      path.resolve(config.cwd, 'skills'),
      this.resolveToolsPath(config),
    );
    diagnostics.push(...await agentProvider.validate(config.agentId));
    const toolProvider = new LocalToolModuleProvider(this.resolveToolsPath(config));
    const toolRefs = await toolProvider.list();
    diagnostics.push({ level: 'info', code: 'tool_modules_loaded', message: `${toolRefs.length} tool module(s) found.` });
    return diagnostics;
  }

  async loadAgent(config: CliConfig, runtime: ConsoleRuntime): Promise<AgentDefinition> {
    const agent = await runtime.agentProvider.load(config.agentId);
    // manifestToAgentDefinition() always fills agent.model with concrete values (its own
    // hardcoded fallback when the agent declares none), so precedence must be resolved
    // against the raw manifest — where "not declared" is genuinely undefined — not agent.model.
    const manifest = await runtime.agentProvider.loadManifest(config.agentId);
    const provider = config.provider ?? manifest?.model?.provider ?? DEFAULT_CLI_CONFIG.provider;
    return {
      ...agent,
      model: {
        ...agent.model,
        provider,
        model: config.model
          ?? manifest?.model?.model
          ?? this.resolveDefaultModel(provider, runtime.modelProviders)
          ?? DEFAULT_CLI_CONFIG.model,
      },
    };
  }

  /** The resolved provider's own first registered model — e.g. NVIDIA_MODELS[0] — so a
   *  provider's default model is never sourced from a different provider's env var. */
  private resolveDefaultModel(providerName: string, providers: readonly CliModelProvider[]): string | undefined {
    return providers.find((candidate) => candidate.name === providerName)?.listModels()[0]?.id;
  }

  private asInteractiveApprovalManager(
    approvalManager: ApprovalRequester | undefined,
    store: PersistenceStore,
  ): InteractiveApprovalManager {
    if (approvalManager instanceof InteractiveApprovalManager) return approvalManager;
    return new InteractiveApprovalManager(store);
  }

  private async loadToolRegistry(config: CliConfig): Promise<RuntimeToolRegistry> {
    const provider = new LocalToolModuleProvider(this.resolveToolsPath(config));
    return new RuntimeToolRegistry(await provider.loadAll());
  }

  private resolveToolsPath(config: CliConfig): string {
    return path.resolve(config.cwd, config.toolsPath);
  }
}
