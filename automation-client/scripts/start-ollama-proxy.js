import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const target = process.env.VITE_OLLAMA_URL || 'http://127.0.0.1:11434';

app.use(
  '/ollama',
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { '^/ollama': '' },
    logLevel: 'info',
  }),
);

const port = process.env.PORT || 5181;
app.listen(port, () => {
  console.log(`Ollama proxy listening on http://localhost:${port}/ollama -> ${target}`);
});
