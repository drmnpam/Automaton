import { BrowserAction } from '../execution/ActionTypes';
import { TaskHistoryEntry, TaskStatus } from './types';

export class StateManager {
  private status: TaskStatus = 'idle';
  private currentStepIndex: number | null = null;
  private currentStep: BrowserAction | null = null;

  private history: TaskHistoryEntry[] = [];

  setStatus(status: TaskStatus) {
    this.status = status;
  }

  getStatus() {
    return this.status;
  }

  setCurrentStep(index: number, step: BrowserAction) {
    this.currentStepIndex = index;
    this.currentStep = step;
  }

  clearCurrentStep() {
    this.currentStepIndex = null;
    this.currentStep = null;
  }

  getCurrentStep() {
    return { index: this.currentStepIndex, step: this.currentStep };
  }

  addToHistory(entry: TaskHistoryEntry) {
    this.history.push(entry);
  }

  getHistory() {
    return this.history;
  }
}

