/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OLLAMA_URL?: string;
  readonly VITE_KAPTURE_MCP_WS_URL?: string;
  readonly VITE_MCP_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
