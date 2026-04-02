/* eslint-disable no-console */

const DEFAULT_BASE_URL = 'https://happybean.naver.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInt(v) {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatKRW(amount) {
  const n = toInt(amount);
  if (n === undefined) return '';
  return n.toLocaleString('ko-KR') + '원';
}

function donationLink(rdonaBoxNo) {
  return `https://happybean.naver.com/donations/${rdonaBoxNo}`;
}

function progressPct(currentAmount, goalAmount) {
  const cur = toInt(currentAmount);
  const goal = toInt(goalAmount);
  if (!cur || !goal || goal <= 0) return undefined;
  // Match UI behavior: int percent, capped at 100.
  const pct = Math.floor((cur / goal) * 100);
  return Math.min(100, Math.max(0, pct));
}

function normalizeBox(b) {
  const pct = progressPct(b.currentAmount, b.goalAmount);
  return {
    rdonaBoxNo: b.rdonaBoxNo,
    title: b.title,
    summary: b.summary,
    hlogName: b.hlogName,
    rdonaBoxType: b.rdonaBoxType,
    stateCode: b.stateCode,
    completeCode: b.completeCode,
    currentAmount: b.currentAmount,
    goalAmount: b.goalAmount,
    progressPct: pct,
    donationCount: b.donationCount,
    startYmd: b.startYmd,
    endYmd: b.endYmd,
    registDate: b.registDate,
    rcmdDate: b.rcmdDate,
    defaultImage: b.defaultImage,
    link: donationLink(b.rdonaBoxNo),
  };
}

function buildRdonaBoxesUrl({
  baseUrl,
  begin,
  end,
  order = 'rcmd_ymdt',
  sortType = 'desc',
  onlyDouble = false,
  lgCatNo = 0,
  supportNo = 0,
} = {}) {
  const u = new URL('/rdona-service/rdona/rdonaboxes', baseUrl || DEFAULT_BASE_URL);
  u.searchParams.set('begin', String(begin));
  u.searchParams.set('end', String(end));
  u.searchParams.set('order', String(order));
  u.searchParams.set('sortType', String(sortType));
  u.searchParams.set('onlyDouble', String(Boolean(onlyDouble)));
  u.searchParams.set('lgCatNo', String(lgCatNo));
  u.searchParams.set('supportNo', String(supportNo));
  return u.toString();
}

async function fetchJson(url, { fetchImpl, signal, headers } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!f) throw new Error('No fetch implementation available');
  const res = await f(url, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'donation-map/1.0 (+https://happybean.naver.com)',
      referer: 'https://happybean.naver.com/donation/DonateHomeMain',
      ...(headers || {}),
    },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

function escapeMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

function toMarkdown(items) {
  const header =
    '| # | 제목 | 단체 | 모금액/목표 | 달성률 | 참여 | 기간 | 링크 |\n' +
    '|---:|---|---|---:|---:|---:|---|---|';
  const lines = items.map((it, idx) => {
    const money = `${formatKRW(it.currentAmount)} / ${formatKRW(it.goalAmount)}`.trim();
    const pct = it.progressPct === undefined ? '' : `${it.progressPct}%`;
    const cnt = it.donationCount === undefined ? '' : `${Number(it.donationCount).toLocaleString('ko-KR')}명`;
    const period = `${it.startYmd || ''} ~ ${it.endYmd || ''}`.trim();
    return `| ${idx + 1} | ${escapeMd(it.title)} | ${escapeMd(it.hlogName)} | ${escapeMd(money)} | ${escapeMd(pct)} | ${escapeMd(cnt)} | ${escapeMd(period)} | ${it.link} |`;
  });
  return [header, ...lines, ''].join('\n');
}

function toCsv(items) {
  const cols = [
    'rdonaBoxNo',
    'title',
    'hlogName',
    'summary',
    'rdonaBoxType',
    'stateCode',
    'completeCode',
    'currentAmount',
    'goalAmount',
    'progressPct',
    'donationCount',
    'startYmd',
    'endYmd',
    'registDate',
    'rcmdDate',
    'defaultImage',
    'link',
  ];
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[\n\r,\"]/g.test(s)) return '"' + s.replace(/\"/g, '""') + '"';
    return s;
  };
  const lines = [cols.join(',')];
  for (const it of items) {
    lines.push(cols.map((c) => esc(it[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

async function crawlDonationList({
  baseUrl,
  order = 'rcmd_ymdt',
  sortType = 'desc',
  onlyDouble = false,
  lgCatNo = 0,
  supportNo = 0,
  // API uses begin/end as inclusive indices.
  // `end = begin + batchSize - 1` yields `batchSize` items when available.
  batchSize = 20,
  delayMs = 120,
  maxRequests = 500,
  fetchImpl,
  signal,
  verbose = false,
} = {}) {
  if (!Number.isFinite(batchSize) || batchSize <= 0) throw new Error('batchSize must be > 0');
  let begin = 1;
  const seen = new Set();
  const raw = [];

  let totalCount;
  let requests = 0;
  let truncated = false;

  while (true) {
    if (requests >= maxRequests) {
      truncated = true;
      break;
    }
    const end = begin + batchSize - 1;
    const url = buildRdonaBoxesUrl({ baseUrl, begin, end, order, sortType, onlyDouble, lgCatNo, supportNo });
    if (verbose) console.error(`[crawl] GET begin=${begin} end=${end} ${url}`);
    const j = await fetchJson(url, { fetchImpl, signal });
    requests += 1;

    if (j?.errorCode) throw new Error(`API errorCode=${j.errorCode} message=${j.errorMessage || ''}`);
    const result = j?.result;
    if (totalCount === undefined && typeof result?.totalCount === 'number') totalCount = result.totalCount;
    const boxes = Array.isArray(result?.rdonaBoxes) ? result.rdonaBoxes : [];
    if (boxes.length === 0) break;

    let added = 0;
    for (const b of boxes) {
      if (!b?.rdonaBoxNo) continue;
      if (seen.has(b.rdonaBoxNo)) continue;
      seen.add(b.rdonaBoxNo);
      raw.push(b);
      added += 1;
    }

    // Advance by the number returned (works regardless of server-side total).
    begin += boxes.length;
    if (totalCount !== undefined && seen.size >= totalCount) break;
    if (added === 0) {
      // Safety: if backend returns duplicates only, avoid infinite loop.
      break;
    }
    if (delayMs) await sleep(delayMs);
  }

  const items = raw.map(normalizeBox);
  return {
    order,
    sortType,
    onlyDouble,
    lgCatNo,
    supportNo,
    batchSize,
    totalCount,
    requests,
    truncated,
    count: items.length,
    items,
  };
}

module.exports = {
  buildRdonaBoxesUrl,
  crawlDonationList,
  normalizeBox,
  progressPct,
  toMarkdown,
  toCsv,
};
