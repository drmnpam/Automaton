import { LLMProvider } from '../LLMProvider';
import { LLMRequest, LLMResponse } from '../types';

type ErrorKind = 'network' | 'api' | 'model' | 'unavailable';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';

  constructor(
    private baseUrl = 'http://127.0.0.1:11434',
    private defaultModel = 'llama3.1',
  ) {}

  private isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  // Used by LLMManager to soft-skip this provider in environments where it cannot work (e.g. browser CORS).
  async isAvailable(): Promise<boolean> {
    if (this.isBrowser()) return false;
    // Best-effort check (Node/bundler environment).
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return [this.defaultModel];
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (this.isBrowser()) {
      const err = new Error(
        'Ollama not running or not reachable from the browser (CORS). Use a backend/proxy to call Ollama.',
      );
      (err as any).kind = 'unavailable' as ErrorKind;
      throw err;
    }

    const model = request.model || this.defaultModel;

    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const user = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const prompt = system ? `${system}\n\n${user}` : user;

    // Ollama REST "chat" endpoint.
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 512,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Ollama API error (HTTP ${res.status}): ${text}`);
      (err as any).kind = 'api' as ErrorKind;
      throw err;
    }

    const json = (await res.json()) as any;
    const content = json?.message?.content ?? '';

    return {
      provider: this.name,
      model,
      content,
      raw: json,
    };
  }
}

