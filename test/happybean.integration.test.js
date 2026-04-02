const test = require('node:test');
const assert = require('node:assert/strict');

const { crawlDonationList } = require('../src/happybean');

test(
  'Happybean crawlDonationList fetches items (integration)',
  { timeout: 30_000 },
  async () => {
    const res = await crawlDonationList({
      batchSize: 20,
      delayMs: 0,
      maxRequests: 2,
    });
    assert.ok(res.count > 0);
    assert.equal(res.truncated, true);
    assert.ok(res.items[0].rdonaBoxNo);
    assert.ok(res.items[0].title);
    assert.ok(res.items[0].link);
  }
);
