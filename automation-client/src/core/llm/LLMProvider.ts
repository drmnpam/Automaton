import { LLMRequest, LLMResponse } from './types';

export interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  // Used by the manager to decide whether this provider can be attempted.
  // Must not throw; return false on "not configured" / "unreachable".
  isAvailable(): Promise<boolean>;
  // Optional: discovery of available models (used for logging / selection).
  getAvailableModels?(): Promise<string[]>;
}

