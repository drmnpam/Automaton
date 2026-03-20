import { describe, expect, it, vi } from 'vitest';
import { LLMManager } from '../core/llm/LLMManager';
import { LLMProvider } from '../core/llm/LLMProvider';
import { LLMRequest } from '../core/llm/types';

class DummyProvider implements LLMProvider {
  constructor(public name: string, public shouldAvailable = true, public text = 'ok') {}
  async isAvailable(): Promise<boolean> {
    return this.shouldAvailable;
  }
  async generate(request: LLMRequest) {
    return { provider: this.name, model: 'test', content: this.text, raw: request };
  }
}

describe('LLMManager', () => {
  it('uses active provider and fallback order', async () => {
    const logs: string[] = [];
    const manager = new LLMManager((msg) => logs.push(msg));
    manager.registerProvider(new DummyProvider('p1', false));
    manager.registerProvider(new DummyProvider('p2', true, 'p2-res'));
    manager.setActiveProvider('p1');

    const resp = await manager.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(resp.provider).toBe('p2');
    expect(resp.content).toBe('p2-res');
  });

  it('throws when no active provider exists', async () => {
    const manager = new LLMManager(() => {});
    await expect(manager.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
  });
});
