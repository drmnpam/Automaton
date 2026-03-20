import { test, expect } from '@playwright/test';

test('app loads and can set task text', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Browser Automation' })).toBeVisible();

  await page.getByRole('combobox', { name: /Provider/i }).selectOption('ollama');

  const taskTextArea = page.getByRole('textbox', { name: /Task/i });
  await taskTextArea.fill('Открыть https://example.com и найти заголовок');
  expect(await taskTextArea.inputValue()).toContain('Открыть https://example.com');

  const runButton = page.getByRole('button', { name: /Run/i });
  await expect(runButton).toBeEnabled();
});
