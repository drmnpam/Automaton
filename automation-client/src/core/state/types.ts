import { BrowserAction } from '../execution/ActionTypes';

export interface TaskHistoryEntry {
  id: string;
  startedAt: number;
  finishedAt?: number;
  taskText: string;
  provider: string;
  plan: BrowserAction[];
  resultSummary?: string;
  error?: string;
}

export type TaskStatus = 'idle' | 'running' | 'paused' | 'success' | 'error';

