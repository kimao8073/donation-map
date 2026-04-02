/* eslint-disable no-console */

const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const DEFAULT_BASE_URL = 'https://www.goodneighbors.kr';
function listPathForPage(pageNo) {
  return `/support/campaign/${pageNo}/campaignList.gn`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absUrl(baseUrl, href) {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl || DEFAULT_BASE_URL).toString();
  } catch {
    return undefined;
  }
}

function normalizeSpace(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textWithBr($el) {
  const clone = $el.clone();
  clone.find('br').replaceWith('\n');
  return String(clone.text() ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchHtmlKr(url, { fetchImpl, signal, headers } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!f) throw new Error('No fetch implementation available');

  const res = await f(url, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.4',
      'user-agent': 'donation-map/1.0 (+https://github.com/) ',
      ...(headers || {}),
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // Despite the meta tag sometimes showing `charset=kr`, real responses can be UTF-8.
  // Prefer charset from response header; fallback to UTF-8 then CP949.
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const m = ct.match(/charset=([^;]+)/);
  const charset = m ? m[1].trim() : '';

  const tryDecode = (enc) => {
    try {
      return iconv.decode(buf, enc);
    } catch {
      return undefined;
    }
  };

  if (charset) {
    const html = tryDecode(charset);
    if (html) return html;
  }

  // UTF-8 first: if it contains lots of replacement chars, fallback.
  const utf8 = buf.toString('utf8');
  const replCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replCount < 5) return utf8;

  return tryDecode('cp949') || utf8;
}

function buildCampaignListUrl({
  baseUrl,
  closeYn = 'N',
  pageNo = 1,
  bizGb = '',
  filter = '',
  totalCount,
} = {}) {
  const u = new URL(listPathForPage(pageNo), baseUrl || DEFAULT_BASE_URL);
  u.searchParams.set('closeYn', closeYn);
  // Some pages include a hidden pageNo that doesn't reflect the current page.
  // The backend uses the path segment for paging, but keeping pageNo in the query is harmless.
  u.searchParams.set('pageNo', String(pageNo));
  if (totalCount !== undefined && totalCount !== null) u.searchParams.set('totalCount', String(totalCount));
  u.searchParams.set('bizGb', bizGb ?? '');
  u.searchParams.set('filter', filter ?? '');
  return u.toString();
}

function parseCampaignListPage(html, { baseUrl } = {}) {
  const $ = cheerio.load(html);
  const items = [];

  const $lis = $('div.gall_list.typeB.tab1 ul.gall_ul > li.gall_li');
  $lis.each((_, li) => {
    const $li = $(li);
    const state = normalizeSpace($li.find('li.gall_img i.icon_state').first().text());
    const detailHref = $li.find('li.gall_img > a[href]').first().attr('href') || $li.find('h2.gall_tit a[href]').first().attr('href');
    const detailUrl = absUrl(baseUrl, detailHref);

    const title = normalizeSpace($li.find('li.gall_txt h2.gall_tit a').first().text());
    const category = normalizeSpace($li.find('li.gall_txt .gall_sort > span').first().text());

    const thumbUrl = absUrl(baseUrl, $li.find('li.gall_img img').first().attr('src'));
    const thumbAlt = normalizeSpace($li.find('li.gall_img img').first().attr('alt'));

    const summary = textWithBr($li.find('li.gall_txt p.gall_stxt').first());

    const donateHref = $li
      .find('li.gall_txt .gall_btn_wrap a.btn_green[href*="/support_pay/"]')
      .first()
      .attr('href');
    const donateUrl = absUrl(baseUrl, donateHref);

    if (!title && !detailUrl) return;

    items.push({
      title,
      state,
      category,
      summary,
      detailUrl,
      thumbUrl,
      thumbAlt,
      donateUrl,
    });
  });

  const pages = [];
  $('div.pagination_wrap .pagination li a[href^="javascript:fnObj.pageSubmit"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/pageSubmit\((\d+)\)/);
    if (!m) return;
    pages.push(Number(m[1]));
  });
  const lastPage = pages.length ? Math.max(...pages.filter(Number.isFinite)) : 1;

  // totalCount is sometimes embedded as a hidden input.
  const totalCount = Number($('input#totalCount[name="totalCount"]').attr('value'));

  return {
    items,
    lastPage,
    totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
  };
}

function escapeMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

function toMarkdown(items) {
  const header =
    '| # | 상태 | 분류 | 제목 | 요약 | 링크 | 후원링크 |\n' +
    '|---:|---|---|---|---|---|---|';
  const lines = items.map((it, idx) => {
    return `| ${idx + 1} | ${escapeMd(it.state)} | ${escapeMd(it.category)} | ${escapeMd(it.title)} | ${escapeMd(it.summary)} | ${it.detailUrl || ''} | ${it.donateUrl || ''} |`;
  });
  return [header, ...lines, ''].join('\n');
}

function toCsv(items) {
  const cols = ['state', 'category', 'title', 'summary', 'detailUrl', 'donateUrl', 'thumbUrl', 'thumbAlt'];
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

async function crawlCampaignList({
  baseUrl,
  closeYn = 'N',
  bizGb = '',
  filter = '',
  startPage = 1,
  endPage,
  delayMs = 150,
  maxPages = 200,
  fetchImpl,
  signal,
  verbose = false,
} = {}) {
  let pageNo = startPage;

  const all = [];
  const seen = new Set();

  let discoveredLastPage;
  let totalCount;
  let truncated = false;

  while (true) {
    if (pageNo - startPage >= maxPages) {
      truncated = true;
      break;
    }

    const url = buildCampaignListUrl({ baseUrl, closeYn, pageNo, bizGb, filter, totalCount });
    if (verbose) console.error(`[crawl] GET pageNo=${pageNo} ${url}`);
    const html = await fetchHtmlKr(url, { fetchImpl, signal, headers: { referer: absUrl(baseUrl, listPathForPage(1)) } });
    const parsed = parseCampaignListPage(html, { baseUrl });

    if (discoveredLastPage === undefined) discoveredLastPage = parsed.lastPage;
    if (totalCount === undefined && parsed.totalCount !== undefined) totalCount = parsed.totalCount;

    for (const it of parsed.items) {
      const key = it.detailUrl || `${it.title}|${it.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(it);
    }

    const effectiveEnd = endPage ?? discoveredLastPage ?? pageNo;
    if (pageNo >= effectiveEnd) break;
    pageNo += 1;
    if (delayMs) await sleep(delayMs);
  }

  return {
    closeYn,
    bizGb,
    filter,
    startPage,
    endPage: endPage ?? discoveredLastPage,
    discoveredLastPage,
    totalCount,
    truncated,
    count: all.length,
    items: all,
  };
}

module.exports = {
  buildCampaignListUrl,
  parseCampaignListPage,
  crawlCampaignList,
  toMarkdown,
  toCsv,
};
