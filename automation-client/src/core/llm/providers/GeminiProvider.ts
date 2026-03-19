import { LLMProvider } from '../LLMProvider';
import { LLMRequest, LLMResponse } from '../types';

type ErrorKind = 'network' | 'api' | 'model' | 'unavailable';

class GeminiProviderError extends Error {
  kind: ErrorKind;
  status?: number;
  attemptedModel?: string;

  constructor(
    message: string,
    kind: ErrorKind,
    opts?: { status?: number; attemptedModel?: string },
  ) {
    super(message);
    this.name = 'GeminiProviderError';
    this.kind = kind;
    this.status = opts?.status;
    this.attemptedModel = opts?.attemptedModel;
  }
}

export interface GeminiProviderConfig {
  baseUrlV1?: string;
  timeoutMs?: number;
  defaultModel?: string | null;
  modelsCacheTtlMs?: number;
  maxModelsDiscoveryPages?: number;
}

export class GeminiProvider implements LLMProvider {
  name = 'gemini';

  private readonly baseUrlV1: string;
  private readonly defaultModel: string | null;
  private readonly timeoutMs: number;
  private readonly modelsCacheTtlMs: number;
  private readonly maxModelsDiscoveryPages: number;

  private availableModelsCache: { models: string[]; fetchedAt: number } | null = null;

  constructor(private apiKey: string, config?: GeminiProviderConfig) {
    // Config can be controlled from environment without UI code changes.
    const envDefaultModel = import.meta.env.VITE_GEMINI_DEFAULT_MODEL as
      | string
      | undefined;

    this.baseUrlV1 = config?.baseUrlV1 ?? 'https://generativelanguage.googleapis.com/v1';
    this.defaultModel = config?.defaultModel ?? envDefaultModel ?? null;
    this.timeoutMs = config?.timeoutMs ?? 25_000;
    this.modelsCacheTtlMs = config?.modelsCacheTtlMs ?? 10 * 60 * 1000; // 10 min
    this.maxModelsDiscoveryPages = config?.maxModelsDiscoveryPages ?? 10;
  }

  private isLikelyModelNotFound(status: number | undefined, message: string) {
    const m = message.toLowerCase();
    return (
      status === 404 ||
      (status != null && status >= 400 && status < 500 && (m.includes('model not found') || m.includes('not found') || m.includes('invalid model'))) ||
      m.includes('api version v1beta') ||
      m.includes('not found for api version')
    );
  }

  private isLocationBlockedMessage(message: string) {
    const m = message.toLowerCase();
    return (
      m.includes('user location is not supported') ||
      m.includes('failed_precondition') ||
      m.includes('failed precondition') ||
      m.includes('location')
    );
  }

  private normalizeErrorText(text: string) {
    return text.replace(/\s+/g, ' ').trim();
  }

  private extractModelId(modelResourceName: string): string {
    // Typical format: "models/gemini-1.5-flash-001"
    if (modelResourceName.startsWith('models/')) {
      return modelResourceName.slice('models/'.length);
    }
    return modelResourceName;
  }

  private async getDiscoverableGenerateContentModels(): Promise<string[]> {
    if (
      this.availableModelsCache &&
      Date.now() - this.availableModelsCache.fetchedAt < this.modelsCacheTtlMs
    ) {
      return this.availableModelsCache.models;
    }

    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('Gemini API key is empty');

    const discovered: string[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined = undefined;
    let page = 0;

    const listOnce = async (baseUrl: string): Promise<any> => {
      const params = new URLSearchParams();
      params.set('key', apiKey);
      params.set('pageSize', '1000');
      if (pageToken) params.set('pageToken', pageToken);

      const url = `${baseUrl.replace(/\/$/, '')}/models?${params.toString()}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = this.normalizeErrorText(text);
        const kind: ErrorKind = this.isLocationBlockedMessage(msg) ? 'unavailable' : 'api';
        const err = new GeminiProviderError(
          `Gemini models list failed (HTTP ${res.status}): ${msg}`,
          kind,
          { status: res.status },
        );
        throw err;
      }
      return res.json();
    };

    // Primary: v1 per requirement. Fallback to v1beta only on 404 for robustness.
    while (true) {
      page++;
      if (page > this.maxModelsDiscoveryPages) break;

      let payload: any;
      try {
        payload = await listOnce(this.baseUrlV1); // .../v1/models
      } catch (e) {
        const err = e as any;
        if (err?.status === 404) {
          // Some accounts/environments might only support v1beta for models.list.
          const v1betaBase = this.baseUrlV1.replace('/v1', '/v1beta');
          payload = await listOnce(v1betaBase);
        } else {
          throw e;
        }
      }

      const models = payload?.models;
      if (!Array.isArray(models)) {
        throw new GeminiProviderError(
          'Invalid response structure from Gemini models discovery (models[] missing)',
          'api',
        );
      }

      for (const m of models) {
        const supported = m?.supportedGenerationMethods;
        if (!Array.isArray(supported)) continue;
        const hasGenerateContent = supported.some(
          (x: any) => String(x) === 'generateContent' || String(x) === 'GenerateContent',
        );
        if (!hasGenerateContent) continue;

        const modelId = typeof m?.name === 'string' ? this.extractModelId(m.name) : null;
        if (!modelId) continue;
        if (!seen.has(modelId)) {
          seen.add(modelId);
          discovered.push(modelId);
        }
      }

      const next = payload?.nextPageToken;
      if (typeof next === 'string' && next.length > 0) {
        pageToken = next;
        continue;
      }
      break;
    }

    if (!discovered.length) {
      throw new GeminiProviderError(
        'No Gemini models found that support generateContent',
        'model',
      );
    }

    console.info(
      `[Gemini] available models: count=${discovered.length} sample="${discovered
        .slice(0, 20)
        .join(', ')}"${discovered.length > 20 ? '...' : ''}`,
    );

    this.availableModelsCache = { models: discovered, fetchedAt: Date.now() };
    return discovered;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const models = await this.getDiscoverableGenerateContentModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return await this.getDiscoverableGenerateContentModels();
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) throw new Error('Gemini API key is empty');

    const requestedModel = request.model;
    const validModels = await this.getDiscoverableGenerateContentModels(); // throws if empty/failed

    const usingModel = validModels[0];
    console.info(`[Gemini] requested model: ${requestedModel}`);
    if (!validModels.includes(requestedModel)) {
      console.info(
        `[Gemini] requested model rejected (not in discovery): requestedModel=${requestedModel} -> using validModels[0]`,
      );
    }
    console.info(`[Gemini] available models count=${validModels.length}; using model=${usingModel}`);

    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const userText = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');
    // Gemini v1 не поддерживает отдельного systemInstruction в REST-пейлоаде.
    // Стабильный вариант: объединить system + user в один prompt.
    const combinedPrompt = systemText
      ? `${systemText}\n\n${userText}`
      : userText;

    const contents = [
      {
        role: 'user',
        parts: [{ text: combinedPrompt || '' }],
      },
    ];

    let lastErr: unknown = null;

    // Try ONLY models returned by discovery. Start from validModels[0] to match requirement.
    for (const model of validModels) {
      if (model !== usingModel) {
        console.info(`[Gemini] fallback attempt within validModels: model=${model}`);
      } else {
        console.info(`[Gemini] using model=${model}`);
      }
      const url = `${this.baseUrlV1}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
        this.apiKey,
      )}`;

      const body: any = {
        contents,
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? 1024,
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const rawText = await res.text();

        if (!res.ok) {
          const normalized = this.normalizeErrorText(rawText);

          if (res.status === 401) {
            throw new GeminiProviderError(
              'Invalid API key for Gemini (401). Проверьте ключ.',
              'api',
              { status: res.status, attemptedModel: model },
            );
          }
          if (res.status === 403) {
            throw new GeminiProviderError(
              'Gemini API key is not authorized (403). Возможно, нет прав/квоты.',
              'api',
              { status: res.status, attemptedModel: model },
            );
          }

          const msg = normalized || `Gemini error HTTP ${res.status}`;
          const kind: ErrorKind = this.isLocationBlockedMessage(msg)
            ? 'unavailable'
            : this.isLikelyModelNotFound(res.status, msg)
              ? 'model'
              : 'api';

          if (kind === 'model') {
            throw new GeminiProviderError(
              `Gemini model not found: ${model}.`,
              'model',
              { status: res.status, attemptedModel: model },
            );
          }

          throw new GeminiProviderError(
            `Gemini API error (HTTP ${res.status}). ${msg}`,
            kind,
            { status: res.status, attemptedModel: model },
          );
        }

        let json: any = null;
        try {
          json = rawText ? JSON.parse(rawText) : null;
        } catch {
          throw new GeminiProviderError(
            'Invalid response structure (cannot parse JSON)',
            'api',
            { attemptedModel: model },
          );
        }

        const candidates = json?.candidates;
        if (!Array.isArray(candidates)) {
          throw new GeminiProviderError(
            'Invalid response structure: candidates is missing',
            'api',
            { attemptedModel: model },
          );
        }
        if (candidates.length === 0) {
          throw new GeminiProviderError(
            'Gemini returned empty response (candidates is empty)',
            'api',
            { attemptedModel: model },
          );
        }

        const parts = candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) {
          throw new GeminiProviderError(
            'Invalid response structure: parts is missing',
            'api',
            { attemptedModel: model },
          );
        }

        const textParts = parts
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .filter((s: string) => s.length > 0);

        const content = textParts.join('');
        if (!content) {
          throw new GeminiProviderError(
            'Gemini returned empty response (no text parts)',
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
      } catch (e) {
        const err = e as any;
        if (err?.name === 'AbortError') {
          lastErr = new GeminiProviderError(
            `Gemini request timeout after ${this.timeoutMs}ms.`,
            'network',
            { attemptedModel: model },
          );
          continue;
        }

        if (err instanceof GeminiProviderError) {
          lastErr = err;
          // Model error -> пробуем следующую модель.
          if (err.kind === 'model') {
            console.info(
              `[Gemini] model unavailable: model=${model} kind=${err.kind} message="${err.message}" -> trying next`,
            );
            continue;
          }
          // Пустой/невалидный ответ -> тоже пробуем следующую модель.
          if (
            err.message.includes('empty response') ||
            err.message.includes('Invalid response structure')
          ) {
            console.info(
              `[Gemini] empty/invalid response: model=${model} message="${err.message}" -> trying next`,
            );
            continue;
          }
          throw err;
        }

        const msg = err?.message ? String(err.message) : String(err);
        lastErr = new GeminiProviderError(
          `Gemini network error. ${msg}`,
          'network',
          { attemptedModel: model },
        );
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }

    // If all model candidates failed, surface the last error.
    if (lastErr instanceof Error) throw lastErr;
    throw new GeminiProviderError('Gemini request failed.', 'api');
  }
}

