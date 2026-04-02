# Donation Map (\uae30\ubd80\uc9c0\ub3c4)

\uc5ec\ub7ec \uae30\ubd80 \ud50c\ub7ab\ud3fc\uc5d0 \ud769\uc5b4\uc838 \uc788\ub294 \uacf5\uac1c \ucea0\ud398\uc778 \ub370\uc774\ud130\ub97c \ud55c \uacf3\uc5d0 \ubaa8\uc544, \uac80\uc0c9/\ud544\ud130\ub85c \ud0d0\uc0c9\ud560 \uc218 \uc788\uac8c \ud558\ub294 \ud504\ub85c\ud1a0\ud0c0\uc785 \ud504\ub85c\uc81d\ud2b8\uc785\ub2c8\ub2e4.

1. \ud06c\ub864\ub9c1: \uacf5\uac1c \ucea0\ud398\uc778 \ub9ac\uc2a4\ud2b8 \uc218\uc9d1(JSON/CSV/MD)
1. LLM \uac00\uacf5: Ollama\ub85c `title`, `oneLineSummary`, `category`, `tags` \uc0dd\uc131(\uce90\uc2dc/\uc99d\ubd84/\uc2e4\ud328 \uc7ac\uc2dc\ub3c4)
1. \uc6f9 \uc11c\ube59: `processed/campaigns.json`\uc744 \uc77d\uc5b4 \uac80\uc0c9\ud615 \uc6f9 UI\uc5d0 \ub098\ud0c0\ub0c4

## Requirements

- Node.js 18+
- Ollama (\ub85c\uceec LLM)\n
## Install

```bash
npm i
```

## Data: Crawl

\uc544\ub798 3\uac1c \uc18c\uc2a4\ub97c \uc218\uc9d1\ud569\ub2c8\ub2e4.

- Kakao \uac19\uc774\uae30\ubd80: `https://together.kakao.com/fundraisings/now`
- GoodNeighbors: `https://www.goodneighbors.kr/support/campaign/1/campaignList.gn`
- Naver Happybean: `https://happybean.naver.com/donation/DonateHomeMain`

\uc608\uc2dc(JSON):

```bash
npm run crawl:now:json
npm run crawl:goodneighbors:json
npm run crawl:happybean:json
```

\ucd9c\ub825\uc740 `out/` \ud3f4\ub354\uc5d0 \uc800\uc7a5\ub429\ub2c8\ub2e4.

## Data: LLM Refinement (Production-like)

\uc6f9\uc5d0\uc11c \uc4f0\ub294 \ucd5c\uc885 \uc0b0\ucd9c\ubb3c\uc740 `processed/campaigns.json` \ud558\ub098\uc785\ub2c8\ub2e4.

### 1) \uc804\uccb4 \uac00\uacf5(\uac15\uc81c \uc7ac\uc0dd\uc131)

```bash
OLLAMA_MODEL=llama3.2:1b FORCE_REFINE=true MAX_REFINE=2000 CONCURRENCY=2 CHECKPOINT_EVERY=10 npm run build:processed
```

### 2) \uc2e4\ud328 \ud56d\ubaa9\ub9cc \uc7ac\uac00\uacf5(\uac19\uc740 \ubaa8\ub378\ub85c \uc7ac\uc2dc\ub3c4)

```bash
OLLAMA_MODEL=llama3.2:1b RETRY_FAILED_ONLY=true npm run build:processed
```

\uc8fc\uc758: \uc791\uc740 \ubaa8\ub378\uc740 \uc885\uc885 \ubb38\uc7a5\uc744 \ube44\uac70\ub098 \uc601\ubb38\uc744 \uc11e\uc5b4 \ubc18\ud658\ud560 \uc218 \uc788\uc5b4, \uc77c\ubd80 \ud56d\ubaa9\uc740 \uc5ec\ub7ec \ubc88 \uc7ac\uc2dc\ub3c4\ud574\uc57c \ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.

## Run Website

```bash
npm start
```

- Main page: `http://127.0.0.1:8787/` (index.html)
- App page: `http://127.0.0.1:8787/main_service.html`
- API: `http://127.0.0.1:8787/api/campaigns`

## CLI

```bash
node bin/cli.js --help
```

\uc608\uc2dc:

```bash
node bin/cli.js now --format json --out out/fundraisings-now.json
node bin/cli.js goodneighbors --format json --out out/goodneighbors-campaigns.json
node bin/cli.js happybean --format json --out out/happybean-donations.json
```

## Notes

- \uac00\uacf5\uc740 \uc8fc\ub85c `scripts/build-processed.js`\uc5d0\uc11c \uc218\ud589\ub429\ub2c8\ub2e4.
- LLM\uc740 Ollama\ub97c \ud1b5\ud574 \ud638\ucd9c\ud558\uba70, \uacb0\uacfc\ub294 `processed/cache.json`\uc5d0 \uce90\uc2f1\ub429\ub2c8\ub2e4(\uc99d\ubd84/\uc7ac\uc2dc\ub3c4\uc6a9).
