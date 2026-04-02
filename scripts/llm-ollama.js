/* eslint-disable no-console */

// Ollama local LLM adapter.
// Requires: Ollama running on http://127.0.0.1:11434

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

function stripNewlines(s) {
  return String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isMostlyKorean(s) {
  const str = stripNewlines(s);
  if (!str) return false;
  const hangul = (str.match(/[가-힣]/g) || []).length;
  const latin = (str.match(/[A-Za-z]/g) || []).length;
  // Allow some latin, but if it's mostly latin it's not a good Korean tag.
  return hangul >= 1 && latin <= Math.max(2, Math.floor(hangul * 0.5));
}

function normalizeCategory(candidate, taxonomy) {
  const raw = stripNewlines(candidate);
  if (!raw) return '기타';
  if (taxonomy.includes(raw)) return raw;

  // Common model slips / synonyms.
  const simplified = raw.replace(/\s+/g, '');
  const alias = {
    아동청소년: '아동/청소년',
    아동: '아동/청소년',
    청소년: '아동/청소년',
    노인: '어르신',
    어르신: '어르신',
    장애질병: '장애/질병',
    장애: '장애/질병',
    질병: '장애/질병',
    동물: '동물',
    환경: '환경',
    재난긴급: '재난/긴급',
    재난: '재난/긴급',
    긴급: '재난/긴급',
    해외: '해외구호',
    해외구호: '해외구호',
    국제: '해외구호',
    주거: '주거',
    교육: '교육',
    기타: '기타',
  };
  const mapped = alias[simplified];
  if (mapped && taxonomy.includes(mapped)) return mapped;

  return '기타';
}

async function ollamaChat({ host, model, messages, format, options, signal }) {
  const url = new URL('/api/chat', host || 'http://127.0.0.1:11434');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(format ? { format } : {}),
      ...(options ? { options } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

async function ollamaTags({ host, signal } = {}) {
  const url = new URL('/api/tags', host || 'http://127.0.0.1:11434');
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

async function ollamaHasModel(model, { host, signal } = {}) {
  const j = await ollamaTags({ host, signal });
  const models = Array.isArray(j?.models) ? j.models : [];
  return models.some((m) => m?.name === model);
}

/**
 * @param {any} campaign normalized campaign
 * @returns {Promise<{title:string, oneLineSummary:string, category:string, tags:string[]}>}
 */
async function refineCampaignWithOllama(campaign, { host, model = 'llama3.2:1b', signal } = {}) {
  const taxonomy = [
    '아동/청소년',
    '어르신',
    '장애/질병',
    '동물',
    '환경',
    '재난/긴급',
    '해외구호',
    '주거',
    '교육',
    '기타',
  ];

  const input = pick(campaign, [
    'source',
    'platform',
    'titleRaw',
    'orgRaw',
    'summaryRaw',
    'categoryRaw',
    'link',
    'startDate',
    'endDate',
    'amountCurrent',
    'amountGoal',
    'progressPct',
    'state',
  ]);

  const system =
    'You transform public donation campaign data into clean, user-facing Korean metadata.' +
    ' Output MUST be valid JSON only (no markdown, no commentary).';

  const user =
    'Given this campaign input JSON, produce a compact refined JSON object for a website.\n' +
    'Hard rules (must follow):\n' +
    '- Output MUST be a single JSON object. No extra keys.\n' +
    '- title and oneLineSummary MUST be non-empty Korean text.\n' +
    `- category MUST be exactly one of: ${taxonomy.join(', ')}\n` +
    '- tags MUST be 3 to 7 items (Korean only), no English words, no #, no duplicates, no empty strings.\n' +
    '- Do NOT invent facts not present in input (e.g., locations, numbers).\n' +
    'Field guidance:\n' +
    '- title: clean Korean title; if input titleRaw exists, base on it\n' +
    '- oneLineSummary: one sentence Korean describing who/what needs help; <= 90 chars\n' +
    'Output schema exactly:\n' +
    '{"title":string,"oneLineSummary":string,"category":string,"tags":string[]}\n' +
    'Input:\n' +
    JSON.stringify(input);

  async function runOnce(temperature) {
    const j = await ollamaChat({
      host,
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Ollama JSON mode (best-effort enforcement).
      format: 'json',
      options: { temperature },
      signal,
    });
    const content = j?.message?.content;
    try {
      return typeof content === 'string' ? JSON.parse(content) : content;
    } catch {
      return null;
    }
  }

  // Small models sometimes emit empty fields; retry once with a different temperature.
  const parsed = (await runOnce(0.2)) || (await runOnce(0.6));
  if (!parsed) throw new Error('Model returned non-JSON content');

  const title = stripNewlines(parsed?.title);
  const oneLineSummary = stripNewlines(parsed?.oneLineSummary);
  const category = normalizeCategory(parsed?.category, taxonomy);
  const tags = Array.isArray(parsed?.tags)
    ? parsed.tags
        .map(stripNewlines)
        .filter(Boolean)
        .filter((t) => isMostlyKorean(t) && t.length <= 12)
    : [];

  if (!title || !oneLineSummary) {
    throw new Error('Model returned empty fields');
  }

  if (!isMostlyKorean(title) || !isMostlyKorean(oneLineSummary)) {
    throw new Error('Model returned non-Korean fields');
  }

  return {
    title,
    oneLineSummary,
    category,
    tags: Array.from(new Set(tags)).slice(0, 7),
  };
}

module.exports = { refineCampaignWithOllama };

module.exports.ollamaTags = ollamaTags;
module.exports.ollamaHasModel = ollamaHasModel;
