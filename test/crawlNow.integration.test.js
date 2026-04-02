const test = require('node:test');
const assert = require('node:assert/strict');

const { crawlFundraisingsNow } = require('../src/kakaoTogether');

// Integration test: hits the real endpoint.
// Kept small to be polite and stable.
test(
  'crawlFundraisingsNow fetches items (integration)',
  { timeout: 30_000 },
  async () => {
    const res = await crawlFundraisingsNow({
      seed: 14,
      size: 10,
      delayMs: 0,
      maxPages: 2,
    });
    assert.ok(res.count > 0);
    assert.equal(res.truncated, true);
    assert.ok(res.items[0].id);
    assert.ok(res.items[0].title);
    assert.ok(res.items[0].link);
  }
);
