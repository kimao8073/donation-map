#!/usr/bin/env node
/* eslint-disable no-console */

// Debug helper: use Playwright to capture network calls while scrolling.
// This is NOT required for library usage.

const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/fundraisings/api/fundraisings/api/v1/')) {
      console.error('[req]', req.method(), url);
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/fundraisings/api/fundraisings/api/v1/')) {
      console.error('[res]', res.status(), url);
    }
  });

  await page.goto('https://together.kakao.com/fundraisings/now', { waitUntil: 'networkidle' });
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(800);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
