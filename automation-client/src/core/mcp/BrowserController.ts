import { BrowserAction } from '../execution/ActionTypes';
import { MCPClient } from './MCPClient';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.innerText ?? '';
}

function normalizeDomResult(res: any): string {
  if (typeof res === 'string') return res;
  if (!res) return '';
  if (typeof res?.text === 'string') return res.text;
  if (typeof res?.html === 'string') return res.html;
  if (typeof res?.dom === 'string') return res.dom;
  if (typeof res?.content === 'string') return res.content;
  if (typeof res?.outerHTML === 'string') return res.outerHTML;
  if (typeof res?.result === 'string') return res.result;
  return JSON.stringify(res);
}

export class BrowserController {
  private tabId: string | null = null;
  private lastKnownUrl: string | null = null;
  private lastSearchQuery: string | null = null;

  constructor(
    private readonly mcp: MCPClient,
    private readonly logger: (msg: string) => void,
  ) {}

  private async ensureTabId() {
    if (this.tabId) return;
    let tabs: any[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      tabs = await this.mcp.listTabs();
      if (tabs.length) break;

      this.logger(`[MCP] no tabs found (attempt ${attempt}/3), trying new_tab...`);
      try {
        const created = await this.mcp.callTool('new_tab', { url: 'about:blank' });
        this.assertToolSuccess('new_tab', created);
      } catch (e) {
        this.logger(`[MCP] new_tab failed: ${(e as Error).message}`);
      }
      await sleep(1200);
    }

    if (!tabs.length) {
      throw new Error('No tabs connected in Kapture MCP after retries (check Kapture extension)');
    }

    this.tabId = String(tabs[0].tabId ?? tabs[0].id ?? '');
    if (!this.tabId) throw new Error('Kapture returned tabs but missing tabId');
    this.logger(`[MCP] using tabId=${this.tabId}`);
  }

  async executeAction(action: BrowserAction): Promise<any> {
    await this.ensureTabId();
    const tabId = this.tabId!;

    switch (action.action) {
      case 'open_url': {
        const url = action.url ?? action.value;
        if (!url) throw new Error('open_url requires value/url');
        this.logger(`[MCP] navigate url=${url}`);
        const res = await this.mcp.callTool('navigate', {
          tabId,
          url,
          timeout: 30_000,
        });
        const ok = this.assertToolSuccess('navigate', res);
        this.rememberContext(action, ok);
        return ok;
      }

      case 'click': {
        if (!action.selector) throw new Error('click requires selector');
        this.logger(`[MCP] click selector=${action.selector}`);
        try {
          const res = await this.mcp.callTool('click', {
            tabId,
            selector: action.selector,
          });
          const ok = this.assertToolSuccess('click', res);
          this.rememberContext(action, ok);
          return ok;
        } catch (e) {
          const err = e as Error;
          if (!this.isElementNotFoundError(err.message)) throw err;

          if (this.isSearchSubmitSelector(action.selector)) {
            const alt = await this.trySearchButtonFallbackClick(tabId, action.selector);
            if (alt) {
              this.rememberContext({ ...action, selector: String(alt.selector ?? action.selector) }, alt);
              return alt;
            }

            const navFallback = await this.trySearchUrlFallback(tabId);
            if (navFallback) {
              this.rememberContext(action, navFallback);
              return navFallback;
            }
          }

          if (this.isVacancyListSelector(action.selector)) {
            const alt = await this.tryVacancyCardFallbackClick(tabId, action.selector);
            if (alt) {
              this.rememberContext({ ...action, selector: String(alt.selector ?? action.selector) }, alt);
              return alt;
            }
          }

          if (this.isResponseSelector(action.selector)) {
            const alt = await this.tryResponseButtonFallbackClick(tabId, action.selector);
            if (alt) {
              this.rememberContext({ ...action, selector: String(alt.selector ?? action.selector) }, alt);
              return alt;
            }
          }

          throw err;
        }
      }

      case 'type': {
        if (!action.selector) throw new Error('type requires selector');
        const value = action.value ?? '';
        this.logger(`[MCP] fill selector=${action.selector}`);
        const res = await this.mcp.callTool('fill', {
          tabId,
          selector: action.selector,
          value,
        });
        const ok = this.assertToolSuccess('fill', res);
        this.rememberContext(action, ok);
        return ok;
      }

      case 'wait': {
        const ms = action.waitMs ?? 1000;
        this.logger(`[MCP] wait ms=${ms}`);
        await sleep(ms);
        return { waitedMs: ms };
      }

      case 'extract': {
        if (!action.selector) throw new Error('extract requires selector');
        this.logger(
          `[MCP] extract selector=${action.selector} strategy=${action.extractStrategy ?? 'inner_text'}`,
        );

        let dom: any;
        try {
          const domRaw = await this.mcp.callTool('dom', {
            tabId,
            selector: action.selector,
          });
          dom = this.assertToolSuccess('dom', domRaw);
        } catch (e) {
          const err = e as Error;
          if (this.isElementNotFoundError(err.message) && this.isVacancyListSelector(action.selector)) {
            const fallbackDom = await this.tryVacancyExtractFallback(tabId, action.selector);
            if (!fallbackDom) throw err;
            dom = fallbackDom;
          } else {
            throw err;
          }
        }

        const html = normalizeDomResult(dom);
        const strategy = action.extractStrategy ?? 'inner_text';
        if (strategy === 'html') {
          return { strategy, html };
        }
        if (strategy === 'attribute') {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const attr = action.attributeName ?? 'href';
          const elFromSelector = action.selector ? doc.querySelector(action.selector) : null;
          const el = elFromSelector ?? doc.body?.firstElementChild ?? null;
          const value = el?.getAttribute(attr) ?? null;
          return { strategy, attribute: attr, value };
        }

        const text = stripHtmlToText(html);
        return { strategy, text, html };
      }

      case 'screenshot': {
        this.logger('[MCP] screenshot');
        try {
          const res = await this.mcp.callTool('screenshot', {
            tabId,
            selector: action.selector,
            scale: 0.5,
          });
          const ok = this.assertToolSuccess('screenshot', res);
          this.rememberContext(action, ok);
          return ok;
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          if (msg.toLowerCase().includes('another debugger is already attached')) {
            this.logger('[MCP] screenshot soft-skip: debugger already attached');
            return {
              warning: 'screenshot_skipped_debugger_conflict',
              message: msg,
              url: this.lastKnownUrl,
            };
          }
          throw e;
        }
      }

      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  private assertToolSuccess(tool: string, result: any) {
    if (!result || typeof result !== 'object') return result;

    if (result.isError === true) {
      throw new Error(`MCP ${tool} failed: ${this.extractErrorMessage(result)}`);
    }
    if (result.error) {
      throw new Error(`MCP ${tool} failed: ${this.extractErrorMessage(result.error)}`);
    }
    if (result.success === false) {
      throw new Error(`MCP ${tool} failed: ${this.extractErrorMessage(result)}`);
    }
    return result;
  }

  private rememberContext(action: BrowserAction, result: any) {
    const urlFromResult = typeof result?.url === 'string' ? result.url : null;
    const urlFromAction = action.action === 'open_url' ? action.url ?? action.value ?? null : null;
    this.lastKnownUrl = urlFromResult ?? urlFromAction ?? this.lastKnownUrl;

    if (
      action.action === 'type' &&
      action.selector &&
      /search|query|text/i.test(action.selector) &&
      typeof action.value === 'string' &&
      action.value.trim().length > 0
    ) {
      this.lastSearchQuery = action.value.trim();
    }
  }

  private isElementNotFoundError(message: string) {
    const m = message.toLowerCase();
    return m.includes('element not found') || m.includes('selector') || m.includes('not found');
  }

  private isSearchSubmitSelector(selector: string) {
    return /search|query|submit/i.test(selector);
  }

  private isVacancyListSelector(selector: string) {
    return /vacancy-serp|serp-item__title|vacancy-title|\/vacancy\//i.test(selector);
  }

  private isResponseSelector(selector: string) {
    return /response|respond|apply|отклик/i.test(selector);
  }

  private async trySearchButtonFallbackClick(tabId: string, originalSelector: string) {
    const candidates = [
      "button[data-qa='search-button']",
      "button[data-qa='search-submit']",
      "button[type='submit']",
      "[data-qa='search-button']",
      "[data-qa='vacancy-search-button']",
      'button[aria-label*="Search"]',
    ];
    return await this.tryClickCandidates(tabId, originalSelector, candidates);
  }

  private async tryVacancyCardFallbackClick(tabId: string, originalSelector: string) {
    const candidates = [
      "a[data-qa='serp-item__title']",
      "a[data-qa='vacancy-serp__vacancy-title']",
      "[data-qa='vacancy-title'] a",
      "a[href*='/vacancy/']",
    ];
    return await this.tryClickCandidates(tabId, originalSelector, candidates);
  }

  private async tryResponseButtonFallbackClick(tabId: string, originalSelector: string) {
    const candidates = [
      "a[data-qa='vacancy-response-link']",
      "a[data-qa='vacancy-response-link-top']",
      "button[data-qa='vacancy-response-link-top']",
      "button[data-qa*='vacancy-response']",
      "a[href*='response']",
      "button[aria-label*='Отклик']",
      "a[aria-label*='Отклик']",
    ];
    return await this.tryClickCandidates(tabId, originalSelector, candidates);
  }

  private async tryClickCandidates(tabId: string, originalSelector: string, candidates: string[]) {
    for (const selector of candidates) {
      if (selector === originalSelector) continue;
      this.logger(`[MCP] click fallback selector=${selector}`);
      try {
        const res = await this.mcp.callTool('click', { tabId, selector });
        const ok = this.assertToolSuccess('click', res);
        return { ...ok, selector };
      } catch {
        // try next selector
      }
    }
    return null;
  }

  private async tryVacancyExtractFallback(tabId: string, originalSelector: string) {
    const candidates = [
      "a[data-qa='serp-item__title']",
      "a[data-qa='vacancy-serp__vacancy-title']",
      "[data-qa='vacancy-title'] a",
      "a[href*='/vacancy/']",
    ];
    for (const selector of candidates) {
      if (selector === originalSelector) continue;
      this.logger(`[MCP] extract fallback selector=${selector}`);
      try {
        const res = await this.mcp.callTool('dom', { tabId, selector });
        const ok = this.assertToolSuccess('dom', res);
        return { ...ok, selector };
      } catch {
        // try next selector
      }
    }
    return null;
  }

  private async trySearchUrlFallback(tabId: string) {
    if (!this.lastSearchQuery) return null;
    const query = encodeURIComponent(this.lastSearchQuery);
    const origin = this.resolveHhOrigin();
    const url = `${origin}/search/vacancy?text=${query}`;

    this.logger(`[MCP] search fallback navigate url=${url}`);
    const res = await this.mcp.callTool('navigate', {
      tabId,
      url,
      timeout: 30_000,
    });
    return this.assertToolSuccess('navigate', res);
  }

  private resolveHhOrigin() {
    try {
      if (this.lastKnownUrl) {
        const u = new URL(this.lastKnownUrl);
        if (u.hostname.includes('hh.ru')) {
          return `${u.protocol}//${u.host}`;
        }
      }
    } catch {
      // ignore parse errors
    }
    return 'https://hh.ru';
  }

  private extractErrorMessage(value: any): string {
    if (!value) return 'unknown error';
    if (typeof value === 'string') return value;
    if (typeof value?.message === 'string') return value.message;
    if (typeof value?.error?.message === 'string') return value.error.message;
    try {
      return JSON.stringify(value);
    } catch {
      return 'unknown error';
    }
  }
}
