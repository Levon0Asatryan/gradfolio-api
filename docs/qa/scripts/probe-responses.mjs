import { createRequire } from 'node:module';
const root = process.env.QA_FRONTEND_ROOT ?? '/qa/gradfolio';
const { chromium } = createRequire(`${root}/package.json`)('@playwright/test');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ storageState: '/qa/state/a.json' });
const failures = [];
page.on('response', (response) => {
  if (response.status() >= 400) failures.push({ status: response.status(), url: response.url() });
});
page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message));
await page.goto('http://localhost:3100/');
await page.waitForLoadState('networkidle');
console.log(JSON.stringify(failures, null, 2));
await browser.close();
