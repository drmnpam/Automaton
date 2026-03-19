export type Role = 'system' | 'user';

export interface LLMMessage {
  role: Role;
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  provider: string;
  model: string;
  content: string;
  raw: unknown;
}

