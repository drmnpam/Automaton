export const KAPTURE_MCP_WS_URL =
  import.meta.env.VITE_KAPTURE_MCP_WS_URL ??
  import.meta.env.VITE_MCP_WS_URL ??
  'ws://localhost:61822/mcp';

export const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30_000;

