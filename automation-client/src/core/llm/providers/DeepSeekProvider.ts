import { LLMProvider } from '../LLMProvider';
import { LLMRequest, LLMResponse } from '../types';

type ErrorKind = 'network' | 'model' | 'api' | 'unavailable';

class DeepSeekProviderError extends Error {
  kind: ErrorKind;
  status?: number;
  attemptedModel?: string;

  constructor(
    message: string,
    kind: ErrorKind,
    opts?: { status?: number; attemptedModel?: string },
  ) {
    super(message);
    this.name = 'DeepSeekProviderError';
    this.kind = kind;
    this.status = opts?.status;
    this.attemptedModel = opts?.attemptedModel;
  }
}

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  private readonly baseUrl: string;
  private readonly availableModels: string[];

  constructor(
    private apiKey: string,
    config?: { baseUrl?: string; availableModels?: string[] },
  ) {
    const envModels = import.meta.env.VITE_DEEPSEEK_MODELS as string | undefined;
    this.baseUrl = config?.baseUrl ?? 'https://api.deepseek.com/v1';
    this.availableModels =
      config?.availableModels ??
      (envModels
        ? envModels.split(',').map((s) => s.trim()).filter(Boolean)
        : ['deepseek-chat']);
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async getAvailableModels(): Promise<string[]> {
    return this.availableModels;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new DeepSeekProviderError('DeepSeek API key is empty', 'api');
    }

    const requestedModel = request.model;
    const model =
      requestedModel && this.availableModels.includes(requestedModel)
        ? requestedModel
        : this.availableModels[0];
    if (!model) throw new DeepSeekProviderError('No DeepSeek models configured', 'unavailable');

    const body = {
      model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1024,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new DeepSeekProviderError(
        `DeepSeek network error: ${(e as any)?.message ?? String(e)}`,
        'network',
      );
    }

    const text = await res.text();
    if (!res.ok) {
      const lower = text.toLowerCase();
      if (res.status === 401 || res.status === 403) {
        throw new DeepSeekProviderError(
          `DeepSeek unauthorized (HTTP ${res.status}).`,
          'api',
          { status: res.status, attemptedModel: model },
        );
      }
      if (res.status === 404 || lower.includes('not found')) {
        throw new DeepSeekProviderError(
          `DeepSeek model not found: ${model}.`,
          'model',
          { status: res.status, attemptedModel: model },
        );
      }
      throw new DeepSeekProviderError(
        `DeepSeek API error (HTTP ${res.status}): ${text}`,
        'api',
        { status: res.status, attemptedModel: model },
      );
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DeepSeekProviderError(
        'Invalid DeepSeek response JSON',
        'api',
        { attemptedModel: model },
      );
    }

    const content = json?.choices?.[0]?.message?.content ?? '';
    if (!content || typeof content !== 'string') {
      throw new DeepSeekProviderError(
        'DeepSeek returned empty content',
        'api',
        { attemptedModel: model },
      );
    }

    return {
      provider: this.name,
      model,
      content,
      raw: json,
    };
  }
}

