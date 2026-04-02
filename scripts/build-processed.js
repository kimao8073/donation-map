#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { refineCampaignWithOllama, ollamaHasModel } = require('./llm-ollama');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeDateYmd(ymd) {
  const s = String(ymd ?? '').trim();
  if (!/^\d{8}$/.test(s)) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeFromKakao(item) {
  const id = item.id;
  const uid = `kakao:${id}`;
  return {
    uid,
    source: 'kakao',
    platform: 'Kakao Together',
    id: String(id),
    titleRaw: item.title,
    orgRaw: item.teamName,
    summaryRaw: item.subTopic,
    categoryRaw: item.subTopic,
    link: item.link,
    donateLink: item.link,
    image: item.mainImageUrl,
    startDate: item.fundraisingStartAt,
    endDate: item.fundraisingEndAt,
    amountCurrent: toNumber(item.totalDonationAmount),
    amountGoal: toNumber(item.targetAmount),
    progressPct: toNumber(item.progressPct),
    donorsCount: toNumber(item.totalDonatorCount),
    state: item.status,
  };
}

function normalizeFromGoodNeighbors(item) {
  const key = item.detailUrl || `${item.title}|${item.category}`;
  const uid = `goodneighbors:${sha256(key).slice(0, 16)}`;
  return {
    uid,
    source: 'goodneighbors',
    platform: 'GoodNeighbors',
    id: item.detailUrl ? item.detailUrl : uid,
    titleRaw: item.title,
    orgRaw: '굿네이버스',
    summaryRaw: item.summary,
    categoryRaw: item.category,
    link: item.detailUrl,
    donateLink: item.donateUrl || item.detailUrl,
    image: item.thumbUrl,
    startDate: undefined,
    endDate: undefined,
    amountCurrent: undefined,
    amountGoal: undefined,
    progressPct: undefined,
    donorsCount: undefined,
    state: item.state,
  };
}

function normalizeFromHappybean(item) {
  const id = item.rdonaBoxNo;
  const uid = `happybean:${id}`;
  return {
    uid,
    source: 'happybean',
    platform: 'Naver Happybean',
    id: String(id),
    titleRaw: item.title,
    orgRaw: item.hlogName,
    summaryRaw: item.summary,
    categoryRaw: item.supportNo ? String(item.supportNo) : undefined,
    link: item.link,
    donateLink: item.link,
    image: item.defaultImage,
    startDate: normalizeDateYmd(item.startYmd),
    endDate: normalizeDateYmd(item.endYmd),
    amountCurrent: toNumber(item.currentAmount),
    amountGoal: toNumber(item.goalAmount),
    progressPct: toNumber(item.progressPct),
    donorsCount: toNumber(item.donationCount),
    state: item.stateCode,
  };
}

function computeContentHash(c) {
  // Only include fields that should influence LLM output.
  const core = {
    source: c.source,
    titleRaw: c.titleRaw,
    orgRaw: c.orgRaw,
    summaryRaw: c.summaryRaw,
    categoryRaw: c.categoryRaw,
    link: c.link,
    startDate: c.startDate,
    endDate: c.endDate,
    amountCurrent: c.amountCurrent,
    amountGoal: c.amountGoal,
    state: c.state,
  };
  return sha256(JSON.stringify(core));
}

function clampArray(arr, n) {
  if (!Number.isFinite(n)) return arr;
  return arr.slice(0, Math.max(0, n));
}

async function mapWithConcurrency(items, concurrency, fn) {
  const n = Math.max(1, Number(concurrency) || 1);
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const RAW_DIR = process.env.RAW_DIR || path.join(process.cwd(), 'out');
  const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'processed');
  // Default to a small local model; override with OLLAMA_MODEL.
  const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';
  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const LLM_ENABLED = (process.env.LLM_ENABLED ?? 'true') !== 'false';
  const CHANGED_ONLY = (process.env.CHANGED_ONLY ?? 'true') !== 'false';
  const FORCE_REFINE = (process.env.FORCE_REFINE ?? 'false') === 'true';
  const MAX_ITEMS = process.env.MAX_ITEMS ? Number(process.env.MAX_ITEMS) : undefined;
  const CONCURRENCY = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : 2;
  const MAX_REFINE = process.env.MAX_REFINE ? Number(process.env.MAX_REFINE) : undefined;
  const CHECKPOINT_EVERY = process.env.CHECKPOINT_EVERY ? Number(process.env.CHECKPOINT_EVERY) : 10;
  const RETRY_FAILED_ONLY = (process.env.RETRY_FAILED_ONLY ?? 'false') === 'true';
  const VERBOSE_ERRORS = (process.env.VERBOSE_ERRORS ?? 'false') === 'true';
  const MAX_ERROR_LOGS = process.env.MAX_ERROR_LOGS ? Number(process.env.MAX_ERROR_LOGS) : 15;
  const DRY_RUN = (process.env.DRY_RUN ?? 'false') === 'true';

  const kakaoPath = path.join(RAW_DIR, 'fundraisings-now.json');
  const goodNeighborsPath = path.join(RAW_DIR, 'goodneighbors-campaigns.json');
  const happybeanPath = path.join(RAW_DIR, 'happybean-donations.json');

  const rawKakao = fs.existsSync(kakaoPath) ? readJson(kakaoPath) : null;
  const rawGn = fs.existsSync(goodNeighborsPath) ? readJson(goodNeighborsPath) : null;
  const rawHb = fs.existsSync(happybeanPath) ? readJson(happybeanPath) : null;

  const normalized = [];
  if (rawKakao?.items) normalized.push(...rawKakao.items.map(normalizeFromKakao));
  if (rawGn?.items) normalized.push(...rawGn.items.map(normalizeFromGoodNeighbors));
  if (rawHb?.items) normalized.push(...rawHb.items.map(normalizeFromHappybean));

  const campaigns = clampArray(normalized, MAX_ITEMS);
  const generatedAt = new Date().toISOString();

  const cachePath = path.join(OUT_DIR, 'cache.json');
  const cache = fs.existsSync(cachePath)
    ? readJson(cachePath)
    : { version: 1, model: MODEL, items: {} };
  if (!cache.items) cache.items = {};

  // Reuse cache even if model changes; store model alongside refined output.
  const tasks = [];
  for (const c of campaigns) {
    const contentHash = computeContentHash(c);
    const prev = cache.items[c.uid];
    const changed = !prev || prev.contentHash !== contentHash;
    const hadError = Boolean(prev && (prev.error || prev.refined === null));
    const modelNotFound = Boolean(
      prev &&
        typeof prev.error === 'string' &&
        /model\s+'[^']+'\s+not found/i.test(prev.error)
    );
    const modelMismatch = Boolean(prev && prev.model && prev.model !== MODEL);

    if (!LLM_ENABLED) continue;

    // Selection logic:
    // - FORCE_REFINE: redo everything
    // - CHANGED_ONLY: refine only changed OR previously failed OR model mismatch
    // - else: refine everything
    // Retry-only mode: reprocess only failed items.
    if (RETRY_FAILED_ONLY) {
      if (hadError) tasks.push({ c, contentHash, changed, hadError, modelMismatch });
      continue;
    }

    // If we previously failed because the model wasn't available, retry now.
    const shouldRefine =
      FORCE_REFINE ||
      (!CHANGED_ONLY ? true : changed || hadError || modelMismatch || modelNotFound);

    if (!shouldRefine) continue;
    tasks.push({ c, contentHash, changed, hadError, modelMismatch });
  }

  // Hourly batch guardrail: cap LLM work per run.
  const tasksCapped = MAX_REFINE !== undefined ? tasks.slice(0, Math.max(0, MAX_REFINE)) : tasks;

  console.error(
    `[build] campaigns=${campaigns.length} llmEnabled=${LLM_ENABLED} changedOnly=${CHANGED_ONLY} forceRefine=${FORCE_REFINE} toRefine=${tasks.length}` +
      (MAX_REFINE !== undefined ? ` capped=${tasksCapped.length}` : '')
  );

  let llmReady = false;
  if (LLM_ENABLED && !DRY_RUN) {
    try {
      llmReady = await ollamaHasModel(MODEL, { host: OLLAMA_HOST });
      if (!llmReady) {
        console.error(`[build] Ollama model not found: ${MODEL}. Set OLLAMA_MODEL or run: ollama pull ${MODEL}`);
      }
    } catch (err) {
      console.error(`[build] Ollama not reachable at ${OLLAMA_HOST}: ${String(err?.message || err)}`);
    }
  }

  if (LLM_ENABLED && llmReady && !DRY_RUN) {
    let updatesSinceCheckpoint = 0;
    let checkpointChain = Promise.resolve();
    let okCount = 0;
    let failCount = 0;
    let loggedErrors = 0;
    const enqueueCheckpoint = () => {
      if (!Number.isFinite(CHECKPOINT_EVERY) || CHECKPOINT_EVERY <= 0) return Promise.resolve();
      updatesSinceCheckpoint++;
      if (updatesSinceCheckpoint < CHECKPOINT_EVERY) return Promise.resolve();
      updatesSinceCheckpoint = 0;
      checkpointChain = checkpointChain.then(() => writeJson(cachePath, cache));
      return checkpointChain;
    };

    await mapWithConcurrency(tasksCapped, CONCURRENCY, async ({ c, contentHash }, i) => {
      try {
        const refined = await refineCampaignWithOllama(c, { host: OLLAMA_HOST, model: MODEL });
        cache.items[c.uid] = {
          contentHash,
          model: MODEL,
          refined,
          updatedAt: new Date().toISOString(),
        };
        okCount++;
        await enqueueCheckpoint();
        if ((i + 1) % 25 === 0) console.error(`[build] refined ${i + 1}/${tasksCapped.length}`);
      } catch (err) {
        failCount++;
        const msg = String(err?.message || err);
        if (VERBOSE_ERRORS || loggedErrors < MAX_ERROR_LOGS) {
          console.error(`[build] refine failed uid=${c.uid} ${msg}`);
          loggedErrors++;
          if (!VERBOSE_ERRORS && loggedErrors === MAX_ERROR_LOGS) {
            console.error(`[build] (suppressing further errors; set VERBOSE_ERRORS=true to show all)`);
          }
        }
        cache.items[c.uid] = {
          contentHash,
          model: MODEL,
          refined: null,
          error: msg,
          updatedAt: new Date().toISOString(),
        };
        await enqueueCheckpoint();
      }
    });

    await checkpointChain;
    console.error(`[build] llm summary ok=${okCount} failed=${failCount}`);
  }

  // Merge for output
  const items = campaigns.map((c) => {
    const cached = cache.items[c.uid];
    const refined = cached?.refined || null;
    const title = refined?.title || c.titleRaw || '';
    const oneLineSummary = refined?.oneLineSummary || c.summaryRaw || '';
    const category = refined?.category || c.categoryRaw || '';
    const tags = Array.isArray(refined?.tags) ? refined.tags : [];
    return {
      uid: c.uid,
      source: c.source,
      platform: c.platform,
      id: c.id,
      title,
      org: c.orgRaw || '',
      oneLineSummary,
      category,
      tags,
      link: c.link,
      donateLink: c.donateLink,
      image: c.image,
      startDate: c.startDate,
      endDate: c.endDate,
      amountCurrent: c.amountCurrent,
      amountGoal: c.amountGoal,
      progressPct: c.progressPct,
      donorsCount: c.donorsCount,
      state: c.state,
      raw: {
        titleRaw: c.titleRaw,
        summaryRaw: c.summaryRaw,
        categoryRaw: c.categoryRaw,
      },
    };
  });

  const out = {
    generatedAt,
    model: LLM_ENABLED ? MODEL : null,
    count: items.length,
    items,
  };

  writeJson(path.join(OUT_DIR, 'campaigns.json'), out);
  writeJson(cachePath, cache);
  console.error(`[build] wrote ${items.length} items -> ${path.join(OUT_DIR, 'campaigns.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
