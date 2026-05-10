import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeEventRecord, TerminalResult } from '../types/index.js';
import type {
  ApprovalRecord,
  PersistenceStore,
  RunSnapshot,
  SessionRecord,
  ToolCallRecord,
} from './PersistenceStore.js';

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const text = await readFile(filePath, 'utf8');
    return text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line) as T) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export class FileStore implements PersistenceStore {
  constructor(private readonly rootDir = '.runtime') {}

  async appendEvent(event: RuntimeEventRecord): Promise<void> {
    await appendJsonl(path.join(this.sessionDir(event.sessionId ?? event.runId), 'events.jsonl'), event);
  }

  async appendMessage(sessionId: string, message: unknown): Promise<void> {
    await appendJsonl(path.join(this.sessionDir(sessionId), 'messages.jsonl'), message);
  }

  async saveToolCall(runId: string, record: ToolCallRecord): Promise<void> {
    await appendJsonl(path.join(this.runDir(runId), 'tool-calls.jsonl'), record);
  }

  async saveApproval(sessionId: string, approval: ApprovalRecord): Promise<void> {
    await appendJsonl(path.join(this.sessionDir(sessionId), 'approvals.jsonl'), approval);
  }

  async saveRunSnapshot(snapshot: RunSnapshot): Promise<void> {
    await writeJson(path.join(this.runDir(snapshot.runId), 'snapshot.json'), snapshot);
  }

  async saveTerminalResult(result: TerminalResult): Promise<void> {
    await writeJson(path.join(this.runDir(result.runId), 'terminal-result.json'), result);
  }

  async loadSession(sessionId: string): Promise<SessionRecord> {
    return {
      sessionId,
      messages: await readJsonl(path.join(this.sessionDir(sessionId), 'messages.jsonl')),
      approvals: await readJsonl<ApprovalRecord>(path.join(this.sessionDir(sessionId), 'approvals.jsonl')),
      events: await readJsonl<RuntimeEventRecord>(path.join(this.sessionDir(sessionId), 'events.jsonl')),
    };
  }

  async loadRunSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.runDir(runId), 'snapshot.json'), 'utf8')) as RunSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, 'sessions', sessionId);
  }

  private runDir(runId: string): string {
    return path.join(this.rootDir, 'runs', runId);
  }
}

