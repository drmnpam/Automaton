import { DEFAULT_MCP_TOOL_TIMEOUT_MS, KAPTURE_MCP_WS_URL } from './config';

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: any;
}

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: T;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: any };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

export class MCPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, { resolve: (v: any) => void; reject: (e: any) => void }>();

  private connected = false;

  constructor(
    private readonly logger: (msg: string) => void,
    private readonly wsUrl = KAPTURE_MCP_WS_URL,
    private readonly toolTimeoutMs = DEFAULT_MCP_TOOL_TIMEOUT_MS,
  ) {}

  async connect() {
    if (this.connected && this.ws) return;

    this.logger(`[MCP] connecting ws=${this.wsUrl}`);

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = async () => {
      this.logger('[MCP] websocket open');
      // Best-effort initialization (some servers might not require it).
      await this.safeInitialize();
      this.connected = true;
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      let msg: JsonRpcResponse<any>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if ('error' in msg) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    };

    this.ws.onerror = () => {
      this.logger('[MCP] websocket error');
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.logger('[MCP] websocket closed');
      for (const [, p] of this.pending) p.reject(new Error('WebSocket closed'));
      this.pending.clear();
    };

    // Wait for open.
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not created'));
      const w = this.ws;
      w.addEventListener(
        'open',
        () => resolve(),
        { once: true },
      );
      w.addEventListener(
        'error',
        () => reject(new Error('WebSocket connection error')),
        { once: true },
      );
    });
  }

  private async safeInitialize() {
    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'kapture-browser-automation-ui', version: '0.1.0' },
        capabilities: {},
      });
      // Some servers expect a separate "initialized" notification; if not, ignore.
      await this.notification('initialized', {});
    } catch (e) {
      this.logger(`[MCP] init skipped: ${(e as Error).message}`);
    }
  }

  async callTool<T = any>(name: string, argumentsObj: any): Promise<T> {
    await this.connect();
    this.logger(`[MCP] callTool name=${name}`);
    const raw = await this.request('tools/call', { name, arguments: argumentsObj }, this.toolTimeoutMs);
    return this.unwrapToolTextJson(raw) as T;
  }

  async listTabs(): Promise<any[]> {
    const res = await this.callTool<any>('list_tabs', {});
    // Kapture typically returns {tabs:[...]} or array directly.
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.tabs)) return res.tabs;
    if (Array.isArray(res?.result)) return res.result;
    return [];
  }

  async screenshot(args: any) {
    return await this.callTool('screenshot', args);
  }

  private async request(method: string, params?: any, timeoutMs = this.toolTimeoutMs): Promise<any> {
    if (!this.ws) throw new Error('WebSocket not connected');
    const id = this.nextId++;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const payload = JSON.stringify(req);
    this.ws.send(payload);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          try {
            const preview =
              typeof v === 'string'
                ? v.slice(0, 200)
                : JSON.stringify(v).slice(0, 200);
            this.logger(`[MCP] response method=${method} preview="${preview}"`);
          } catch {
            // ignore preview failures
          }
          resolve(v);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private async notification(method: string, params?: any) {
    if (!this.ws) throw new Error('WebSocket not connected');
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `n-${Date.now()}-${Math.random()}`,
      method,
      params,
    };
    this.ws.send(JSON.stringify(req));
  }

  private unwrapToolTextJson(value: any): any {
    const content = value?.content;
    if (!Array.isArray(content)) return value;

    const text = content
      .map((item: any) => (item?.type === 'text' && typeof item?.text === 'string' ? item.text : ''))
      .join('\n')
      .trim();
    if (!text) return value;

    // 1) Plain JSON text.
    try {
      return JSON.parse(text);
    } catch {
      // ignore
    }

    // 2) Markdown fenced JSON.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        // ignore
      }
    }

    // 3) Best-effort first object extraction.
    const firstObjStart = text.indexOf('{');
    const lastObjEnd = text.lastIndexOf('}');
    if (firstObjStart >= 0 && lastObjEnd > firstObjStart) {
      const candidate = text.slice(firstObjStart, lastObjEnd + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // ignore
      }
    }

    return value;
  }
}

