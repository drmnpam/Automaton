import { LLMProvider } from '../LLMProvider';
import { LLMRequest, LLMResponse } from '../types';

type ErrorKind = 'network' | 'model' | 'api' | 'unavailable';

class ClaudeProviderError extends Error {
  kind: ErrorKind;
  status?: number;
  attemptedModel?: string;

  constructor(
    message: string,
    kind: ErrorKind,
    opts?: { status?: number; attemptedModel?: string },
  ) {
    super(message);
    this.name = 'ClaudeProviderError';
    this.kind = kind;
    this.status = opts?.status;
    this.attemptedModel = opts?.attemptedModel;
  }
}

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private readonly baseUrl: string;
  private readonly availableModels: string[];

  constructor(
    private apiKey: string,
    config?: { baseUrl?: string; availableModels?: string[] },
  ) {
    const envModels = import.meta.env.VITE_CLAUDE_MODELS as string | undefined;
    this.baseUrl = config?.baseUrl ?? 'https://api.anthropic.com/v1';
    this.availableModels =
      config?.availableModels ??
      (envModels
        ? envModels.split(',').map((s) => s.trim()).filter(Boolean)
        : ['claude-3-5-sonnet-20241022']);
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async getAvailableModels(): Promise<string[]> {
    return this.availableModels;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) throw new ClaudeProviderError('Claude API key is empty', 'api');

    const requestedModel = request.model;
    const model =
      requestedModel && this.availableModels.includes(requestedModel)
        ? requestedModel
        : this.availableModels[0];
    if (!model) throw new ClaudeProviderError('No Claude models configured', 'unavailable');

    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const userText = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const body: any = {
      model,
      system: systemText || undefined,
      messages: [
        {
          role: 'user',
          content: userText,
        },
      ],
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ClaudeProviderError(
        `Claude network error: ${(e as any)?.message ?? String(e)}`,
        'network',
      );
    }

    const text = await res.text();
    if (!res.ok) {
      const lower = text.toLowerCase();
      if (res.status === 401 || res.status === 403) {
        throw new ClaudeProviderError(
          `Claude unauthorized (HTTP ${res.status}).`,
          'api',
          { status: res.status, attemptedModel: model },
        );
      }
      if (res.status === 404 || lower.includes('not found')) {
        throw new ClaudeProviderError(
          `Claude model not found: ${model}.`,
          'model',
          { status: res.status, attemptedModel: model },
        );
      }
      throw new ClaudeProviderError(
        `Claude API error (HTTP ${res.status}): ${text}`,
        'api',
        { status: res.status, attemptedModel: model },
      );
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ClaudeProviderError('Invalid Claude response JSON', 'api', { attemptedModel: model });
    }

    const contentParts = json?.content;
    const content = Array.isArray(contentParts)
      ? contentParts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
      : '';

    if (!content || typeof content !== 'string') {
      throw new ClaudeProviderError('Claude returned empty content', 'api', { attemptedModel: model });
    }

    return {
      provider: this.name,
      model,
      content,
      raw: json,
    };
  }
}

