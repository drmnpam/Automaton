import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../core/llm/providers/OllamaProvider';

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unavailable when /api/tags fails', async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new Error('network')); 
    const provider = new OllamaProvider('http://127.0.0.1:11434');
    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it('returns parsed chat response', async () => {
    const fakeResp = {
      ok: true,
      json: async () => ({ message: { content: 'hello' } }),
    };
    (globalThis.fetch as any).mockResolvedValue(fakeResp);

    const provider = new OllamaProvider('http://127.0.0.1:11434');
    const out = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.content).toBe('hello');
  });
});
