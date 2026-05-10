import { ConsoleCommandRegistry } from '../ConsoleCommandRegistry.js';
import type { ConsoleCommand } from '../ConsoleCommand.js';
import { ConsoleModes } from '../ConsoleMode.js';

export function createDefaultCommandRegistry(): ConsoleCommandRegistry {
  const registry = new ConsoleCommandRegistry();
  const commands = [
    helpCommand(registry),
    exitCommand(),
    statusCommand(),
    clearCommand(),
    historyCommand(),
    cancelCommand(),
    toolsCommand(),
    skillsCommand(),
    agentsCommand(),
    debugCommand(),
    approveCommand(),
    rejectCommand(),
  ];
  for (const command of commands) registry.register(command);
  return registry;
}

function helpCommand(registry: ConsoleCommandRegistry): ConsoleCommand {
  return {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands.',
    usage: '/help',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute() {
      const lines = registry.list().map((command) => `${command.usage} - ${command.description}`);
      return { status: 'success', message: lines.join('\n') };
    },
  };
}

function exitCommand(): ConsoleCommand {
  return {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the console.',
    usage: '/exit',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      session.mode = ConsoleModes.Exiting;
      return { status: 'exit', message: 'Goodbye.' };
    },
  };
}

function statusCommand(): ConsoleCommand {
  return {
    name: 'status',
    description: 'Show session and runtime status.',
    usage: '/status',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      return { status: 'success', data: session.getStatus() };
    },
  };
}

function clearCommand(): ConsoleCommand {
  return {
    name: 'clear',
    description: 'Clear local console history and queued prompts.',
    usage: '/clear',
    async execute(_input, session) {
      session.history.clear();
      session.queue.clear();
      return { status: 'success', message: 'Console history cleared.' };
    },
  };
}

function historyCommand(): ConsoleCommand {
  return {
    name: 'history',
    description: 'Show local console history.',
    usage: '/history',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      return { status: 'success', data: session.history.list() };
    },
  };
}

function cancelCommand(): ConsoleCommand {
  return {
    name: 'cancel',
    description: 'Cancel the active run.',
    usage: '/cancel',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      return session.cancelActiveRun()
        ? { status: 'success', message: 'Cancellation requested.' }
        : { status: 'error', errorCode: 'no_active_run', message: 'No active run to cancel.' };
    },
  };
}

function toolsCommand(): ConsoleCommand {
  return {
    name: 'tools',
    description: 'List registered tools.',
    usage: '/tools',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      await session.initialize();
      return { status: 'success', data: session.runtime?.toolRegistry.names() ?? [] };
    },
  };
}

function skillsCommand(): ConsoleCommand {
  return {
    name: 'skills',
    description: 'List skills referenced by the active agent.',
    usage: '/skills',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      await session.initialize();
      const skills = await session.runtime?.agentProvider.loadSkillsForAgent(session.config.agentId) ?? [];
      return { status: 'success', data: skills.map((skill) => ({ id: skill.id, name: skill.name, invocationMode: skill.invocationMode })) };
    },
  };
}

function agentsCommand(): ConsoleCommand {
  return {
    name: 'agents',
    description: 'List available local Markdown agents.',
    usage: '/agents',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      await session.initialize();
      return { status: 'success', data: await session.runtime?.agentProvider.listAgents() ?? [] };
    },
  };
}

function debugCommand(): ConsoleCommand {
  return {
    name: 'debug',
    description: 'Show runtime debug information.',
    usage: '/debug',
    allowedWhileRunning: true,
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      const stats = session.runtime?.eventBus.getStats();
      return { status: 'success', data: { ...session.getStatus(), eventBus: stats } };
    },
  };
}

function approveCommand(): ConsoleCommand {
  return {
    name: 'approve',
    description: 'Approve the pending tool request.',
    usage: '/approve',
    allowedWhileApprovalWaiting: true,
    async execute(_input, session) {
      const pending = session.runtime?.approvalManager.getPendingApproval();
      if (!pending) return { status: 'error', errorCode: 'no_pending_approval', message: 'No approval is pending.' };
      const approval = session.runtime!.approvalManager.approve();
      return { status: 'success', message: `Approved ${approval.id}.`, data: approval };
    },
  };
}

function rejectCommand(): ConsoleCommand {
  return {
    name: 'reject',
    description: 'Reject the pending tool request.',
    usage: '/reject',
    allowedWhileApprovalWaiting: true,
    async execute(input, session) {
      const pending = session.runtime?.approvalManager.getPendingApproval();
      if (!pending) return { status: 'error', errorCode: 'no_pending_approval', message: 'No approval is pending.' };
      const approval = session.runtime!.approvalManager.reject(input.args.join(' ') || 'Rejected by user.');
      return { status: 'success', message: `Rejected ${approval.id}.`, data: approval };
    },
  };
}
