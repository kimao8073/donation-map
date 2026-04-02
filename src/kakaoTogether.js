/* eslint-disable no-console */

const DEFAULT_BASE_URL = 'https://together.kakao.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInt(v) {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatCurrencyKRW(amount) {
  const n = toInt(amount);
  if (n === undefined) return '';
  return n.toLocaleString('ko-KR') + '원';
}

function formatNumber(n) {
  const v = toInt(n);
  if (v === undefined) return '';
  return v.toLocaleString('ko-KR');
}

function daysUntil(dateStr) {
  if (!dateStr) return undefined;
  // dateStr is 'YYYY-MM-DD'
  const [y, m, d] = dateStr.split('-').map((x) => Number(x));
  if (![y, m, d].every(Number.isFinite)) return undefined;
  const end = new Date(Date.UTC(y, m - 1, d));
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = end.getTime() - todayUtc.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function donationProgressPct(totalDonationAmount, targetAmount) {
  const total = toInt(totalDonationAmount);
  const target = toInt(targetAmount);
  if (!total || !target || target <= 0) return undefined;
  return Math.round((total / target) * 1000) / 10; // 0.1% precision
}

function fundraisingLink(id) {
  return `https://together.kakao.com/fundraisings/${id}/story`;
}

function normalizeFundraisingRow(row) {
  const pct = donationProgressPct(row.totalDonationAmount, row.targetAmount);
  const dleft = daysUntil(row.fundraisingEndAt);
  return {
    id: row.id,
    title: row.title,
    subTopic: row.subTopic,
    teamName: row.teamName,
    fundraisingStartAt: row.fundraisingStartAt,
    fundraisingEndAt: row.fundraisingEndAt,
    daysLeft: dleft,
    totalDonationAmount: row.totalDonationAmount,
    targetAmount: row.targetAmount,
    progressPct: pct,
    totalDonatorCount: row.totalDonatorCount,
    status: row.status,
    link: fundraisingLink(row.id),
    mainImageUrl: row.mainImageUrl,
  };
}

function escapeMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function toMarkdown(items) {
  const header =
    '| # | 제목 | 단체 | 주제 | 모금액/목표 | 달성률 | 참여 | 종료 | 링크 |\n' +
    '|---:|---|---|---|---:|---:|---:|---:|---|';
  const lines = items.map((it, idx) => {
    const money = `${formatCurrencyKRW(it.totalDonationAmount)} / ${formatCurrencyKRW(it.targetAmount)}`.trim();
    const pct = it.progressPct === undefined ? '' : `${it.progressPct}%`;
    const donors = it.totalDonatorCount === undefined ? '' : `${formatNumber(it.totalDonatorCount)}명`;
    let end = it.fundraisingEndAt || '';
    if (it.daysLeft !== undefined) {
      end = it.daysLeft < 0 ? `${end} (종료)` : `${end} (D-${it.daysLeft})`;
    }
    return `| ${idx + 1} | ${escapeMd(it.title)} | ${escapeMd(it.teamName)} | ${escapeMd(it.subTopic)} | ${escapeMd(money)} | ${escapeMd(pct)} | ${escapeMd(donors)} | ${escapeMd(end)} | ${it.link} |`;
  });
  return [header, ...lines, ''].join('\n');
}

function toCsv(items) {
  const cols = [
    'id',
    'title',
    'teamName',
    'subTopic',
    'fundraisingStartAt',
    'fundraisingEndAt',
    'daysLeft',
    'totalDonationAmount',
    'targetAmount',
    'progressPct',
    'totalDonatorCount',
    'status',
    'link',
    'mainImageUrl',
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

async function fetchJson(url, { fetchImpl, signal, headers } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!f) throw new Error('No fetch implementation available');
  const res = await f(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'donation-map/1.0 (+https://together.kakao.com)',
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

function buildNowApiUrl({ baseUrl, page, size, seed, categoryId, sort }) {
  const u = new URL('/fundraisings/api/fundraisings/api/v1/fundraisings/now', baseUrl || DEFAULT_BASE_URL);
  u.searchParams.set('page', String(page));
  u.searchParams.set('size', String(size));
  u.searchParams.set('seed', String(seed));
  // These params are not confirmed for all combinations, but harmless if ignored.
  if (categoryId !== undefined && categoryId !== null) u.searchParams.set('categoryId', String(categoryId));
  if (sort) u.searchParams.set('sort', String(sort));
  return u.toString();
}

/**
 * Crawl the full fundraising list (same dataset as infinite scroll) via the internal API.
 */
async function crawlFundraisingsNow({
  baseUrl,
  seed = Math.floor(Math.random() * 1000) + 1,
  // The backend currently only accepts specific sizes (10, 20 observed).
  size = 20,
  delayMs = 150,
  maxPages = 500,
  categoryId,
  sort,
  fetchImpl,
  signal,
  verbose = false,
} = {}) {
  if (size <= 0) throw new Error('size must be > 0');
  const seenIds = new Set();
  /** @type {any[]} */
  const raw = [];

  let page = 0;
  let totalPages = undefined;
  let totalElement = undefined;
  let last = false;

  let truncated = false;

  while (!last) {
    if (page >= maxPages) {
      truncated = true;
      break;
    }
    const url = buildNowApiUrl({ baseUrl, page, size, seed, categoryId, sort });
    if (verbose) console.error(`[crawl] GET page=${page} ${url}`);
    const data = await fetchJson(url, { fetchImpl, signal, headers: { referer: 'https://together.kakao.com/fundraisings/now' } });

    if (totalPages === undefined && typeof data.totalPages === 'number') totalPages = data.totalPages;
    if (totalElement === undefined && typeof data.totalElement === 'number') totalElement = data.totalElement;
    last = Boolean(data.last);
    const content = Array.isArray(data.content) ? data.content : [];
    for (const row of content) {
      if (!row || row.id === undefined || row.id === null) continue;
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      raw.push(row);
    }

    // Break on empty pages to avoid infinite loops if backend changes.
    if (content.length === 0) {
      if (verbose) console.error(`[crawl] empty content at page=${page}, stopping`);
      break;
    }

    page += 1;
    if (delayMs) await sleep(delayMs);
    if (totalPages !== undefined && page >= totalPages) break;
  }

  const items = raw.map(normalizeFundraisingRow);
  return {
    seed,
    size,
    fetchedPages: page,
    totalPages,
    totalElement,
    truncated,
    count: items.length,
    items,
  };
}

module.exports = {
  crawlFundraisingsNow,
  toMarkdown,
  toCsv,
  normalizeFundraisingRow,
  buildNowApiUrl,
  formatCurrencyKRW,
  donationProgressPct,
  daysUntil,
};
