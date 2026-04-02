#!/usr/bin/env node
/* eslint-disable no-console */

// CLI wrapper (kept separate from library exports)

const fs = require('node:fs');
const path = require('node:path');

const { kakaoTogether, goodNeighbors, happybean } = require('../src');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const [k, v] = a.split('=', 2);
    const key = k.slice(2);
    if (v !== undefined) args[key] = v;
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  donation-map now --format md --out out.md',
    '  donation-map goodneighbors --format md --out out.md',
    '  donation-map happybean --format md --out out.md',
    '',
    'Commands:',
    '  now           Kakao Together fundraisings (infinite scroll dataset)',
    '  goodneighbors GoodNeighbors campaign list (paginates)',
    '  happybean     Naver Happybean donation list ("load more" dataset)',
    '',
    'Options:',
    '  --format md|json|csv    Output format (default: md)',
    '  --out <file>            Output file path (default: stdout)',
    '  --delayMs <n>           Delay between requests (default: 150)',
    '  --verbose               Print progress to stderr',
    '',
    'Kakao Together (now) options:',
    '  --seed <n>              Seed used by backend random ordering (default: random)',
    '  --size <n>              Page size (default: 20)',
    '  --maxPages <n>          Safety cap (default: 500)',
    '',
    'GoodNeighbors options:',
    '  --closeYn N|Y            진행중(N) / 종료(Y) (default: N)',
    '  --pageNo <n>             시작 페이지 (default: 1)',
    '  --endPage <n>            끝 페이지 (default: last page)',
    '  --bizGb <text>           카테고리 필터 (default: empty)',
    '  --filter <text>          검색어 (default: empty)',
    '  --maxPages <n>           Safety cap (default: 200)',
    '',
    'Happybean options:',
    '  --order <text>           정렬 키 (default: rcmd_ymdt)',
    '  --sortType asc|desc      정렬 방향 (default: desc)',
    '  --onlyDouble true|false  더블기부만 (default: false)',
    '  --lgCatNo <n>            theme (default: 0)',
    '  --supportNo <n>          지원사업 카테고리 (default: 0)',
    '  --batchSize <n>          요청당 개수 (default: 20)',
    '  --maxRequests <n>        요청 제한 (default: 500)',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (cmd !== 'now' && cmd !== 'goodneighbors' && cmd !== 'happybean') {
    console.error(`Unknown command: ${cmd}`);
    console.error(usage());
    process.exit(2);
  }

  const format = (args.format || 'md').toLowerCase();
  const delayMs = args.delayMs !== undefined ? Number(args.delayMs) : undefined;
  const verbose = Boolean(args.verbose);

  let result;
  let output;

  if (cmd === 'now') {
    const seed = args.seed !== undefined ? Number(args.seed) : undefined;
    const size = args.size !== undefined ? Number(args.size) : undefined;
    const maxPages = args.maxPages !== undefined ? Number(args.maxPages) : undefined;
    result = await kakaoTogether.crawlFundraisingsNow({ seed, size, delayMs, maxPages, verbose });

    if (format === 'json') output = JSON.stringify(result, null, 2) + '\n';
    else if (format === 'csv') output = kakaoTogether.toCsv(result.items);
    else if (format === 'md' || format === 'markdown') output = kakaoTogether.toMarkdown(result.items);
    else {
      console.error(`Unsupported format: ${format}`);
      process.exit(2);
    }
  } else if (cmd === 'happybean') {
    const order = args.order !== undefined ? String(args.order) : 'rcmd_ymdt';
    const sortType = args.sortType !== undefined ? String(args.sortType) : 'desc';
    const onlyDouble = args.onlyDouble !== undefined ? String(args.onlyDouble) === 'true' : false;
    const lgCatNo = args.lgCatNo !== undefined ? Number(args.lgCatNo) : 0;
    const supportNo = args.supportNo !== undefined ? Number(args.supportNo) : 0;
    const batchSize = args.batchSize !== undefined ? Number(args.batchSize) : undefined;
    const maxRequests = args.maxRequests !== undefined ? Number(args.maxRequests) : undefined;

    result = await happybean.crawlDonationList({
      order,
      sortType,
      onlyDouble,
      lgCatNo,
      supportNo,
      batchSize,
      delayMs,
      maxRequests,
      verbose,
    });

    if (format === 'json') output = JSON.stringify(result, null, 2) + '\n';
    else if (format === 'csv') output = happybean.toCsv(result.items);
    else if (format === 'md' || format === 'markdown') output = happybean.toMarkdown(result.items);
    else {
      console.error(`Unsupported format: ${format}`);
      process.exit(2);
    }
  } else {
    const closeYn = args.closeYn ? String(args.closeYn) : 'N';
    const startPage = args.pageNo !== undefined ? Number(args.pageNo) : 1;
    const endPage = args.endPage !== undefined ? Number(args.endPage) : undefined;
    const maxPages = args.maxPages !== undefined ? Number(args.maxPages) : undefined;
    const bizGb = args.bizGb !== undefined ? String(args.bizGb) : '';
    const filter = args.filter !== undefined ? String(args.filter) : '';

    result = await goodNeighbors.crawlCampaignList({
      closeYn,
      startPage,
      endPage,
      bizGb,
      filter,
      delayMs,
      maxPages,
      verbose,
    });

    if (format === 'json') output = JSON.stringify(result, null, 2) + '\n';
    else if (format === 'csv') output = goodNeighbors.toCsv(result.items);
    else if (format === 'md' || format === 'markdown') output = goodNeighbors.toMarkdown(result.items);
    else {
      console.error(`Unsupported format: ${format}`);
      process.exit(2);
    }
  }

  if (result.truncated) {
    const cap =
      cmd === 'happybean'
        ? `--maxRequests=${args.maxRequests ?? 500}`
        : `--maxPages=${args.maxPages ?? (cmd === 'goodneighbors' ? 200 : 500)}`;
    console.error(`WARNING: output is truncated (reached ${cap}). Increase the cap to fetch more.`);
  }

  if (args.out) {
    const outPath = path.resolve(process.cwd(), String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output);
    console.error(`Wrote ${result.count} items to ${outPath}`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
