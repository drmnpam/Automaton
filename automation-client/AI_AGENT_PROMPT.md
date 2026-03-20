# AI Agent prompt template for Kapture Automation Client

## Цель
Помочь будущему AI-агенту понять архитектуру, конфигурацию, запуск и развитие проекта.

## Структура репозитория
- `automation-client/src/App.tsx` - React UI, основной пользовательский поток.
- `automation-client/src/core/llm` - LLM-клиенты и менеджер:
  - `LLMProvider` - интерфейс
  - `LLMManager` - fallback + retry + классификация ошибок
  - `providers` - конкретные библиотеки: OpenRouter, Gemini, OpenAI, Claude, DeepSeek, Ollama.
- `automation-client/src/core/planning` - преобразование задачи в tool-call.
- `automation-client/src/core/execution` - `TaskExecutor` реализует цикл: план -> выполнение -> checkpoint/resume.
- `automation-client/src/core/mcp` - транспорт Kapture MCP и BrowserController.
- `automation-client/.env.example` - настройка URL и ключей.

## Особенности локальной модели
- `OllamaProvider` с параметром `VITE_OLLAMA_URL`.
- CORS через proxy:
  - `automation-client/scripts/start-ollama-proxy.js`
- UI показывает статус доступности.

## Как запускать
1. `cd automation-client`
2. `npm install`
3. `npm run dev -- --host 127.0.0.1 --port 5180`
4. перейти на `http://127.0.0.1:5180`

## Тесты и CI
- `npm test` выполнит `vitest run --coverage`
- GitHub Actions: `.github/workflows/ci.yml`

## Новый функционал, который должен выполнять агент
1. Проверять и поддерживать работоспособность `OllamaProvider`.
2. Проверять доступность MCP, обновлять `mcpDisconnected`.
3. Обновлять логи и статус "provider" в интерфейсе.
4. Добавлять передовые модели и провайдеры (HuggingFace, llama.cpp, gpt4all).

## Приоритетные задачи
- надёжность (retry, fallback)
- тестовое покрытие (TaskExecutor, LLMManager, OllamaProvider)
- UX (статус доступности, история выполнения)
- документация
