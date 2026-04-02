# Donation Map (기부지도)

여러 기부 플랫폼에 흩어진 **공개 캠페인 데이터**를 한 곳에 모아,
LLM(Ollama)으로 사용자 친화 메타데이터를 생성하고(제목 정리/한줄요약/카테고리/태그),
웹 UI에서 검색·필터로 탐색할 수 있게 만드는 로컬 프로토타입입니다.

- 수집 대상
  - Kakao 같이기부: `https://together.kakao.com/fundraisings/now`
  - GoodNeighbors: `https://www.goodneighbors.kr/support/campaign/1/campaignList.gn`
  - Naver Happybean: `https://happybean.naver.com/donation/DonateHomeMain`
- 최종 산출물
  - `processed/campaigns.json` (웹에서 읽는 단일 JSON)
- 핵심 특징
  - 증분 가공: 원본 내용이 바뀐 캠페인만 다시 LLM 가공
  - 캐시/체크포인트: 중간에 중단되어도 진행 상황이 `processed/cache.json`에 저장
  - 실패 재가공: 실패 항목만 다시 돌리는 모드 제공

## Quick Start

```bash
npm i

# 1) 크롤링(JSON)
npm run crawl:now:json
npm run crawl:goodneighbors:json
npm run crawl:happybean:json

# 2) LLM 가공 (Ollama 필요)
OLLAMA_MODEL=llama3.2:1b FORCE_REFINE=true MAX_REFINE=2000 CONCURRENCY=2 CHECKPOINT_EVERY=10 npm run build:processed

# 3) 웹 실행
npm start
```

## Server Scripts

서버 운영을 "실제 프로덕션처럼" 나눠 실행할 수 있도록, 아래 3개의 실행 파일을 제공합니다.

1. 서버 셋업(의존성 + Ollama 모델 확인/다운로드 + 최초 데이터 생성)
   - 실행: `npm run server:setup`
2. 서버 데이터 새로고침(크롤링 + LLM 가공)
   - 실행: `npm run server:refresh`
3. 서버 시작(웹 서버만 실행)
   - 실행: `npm run server:start`

### server:setup

```bash
OLLAMA_MODEL=llama3.2:1b npm run server:setup
```

하는 일:

1. `node_modules`가 없으면 `npm i`
2. Ollama 접속 확인 후 모델이 없으면 `ollama pull`
3. `server:refresh`를 1회 수행해 `processed/campaigns.json`을 만들어 둠

### server:refresh

```bash
OLLAMA_MODEL=llama3.2:1b npm run server:refresh
```

하는 일:

1. `out/*.json` 갱신을 위해 3개 소스를 다시 크롤링
2. `scripts/build-processed.js`를 실행해 `processed/cache.json`과 `processed/campaigns.json` 갱신

기본은 증분 업데이트(`CHANGED_ONLY=true`)이며, 전체 재가공이 필요하면:

```bash
FORCE_REFINE=true OLLAMA_MODEL=llama3.2:1b npm run server:refresh
```

### server:start

```bash
npm run server:start
```

웹 서버만 실행합니다. (데이터가 없으면 `server:refresh`를 안내 메시지로 출력)

- 메인 페이지: `http://127.0.0.1:8787/` (`index.html`)
- 앱 페이지: `http://127.0.0.1:8787/main_service.html`
- API: `http://127.0.0.1:8787/api/campaigns`

## Requirements

- Node.js 18+
- Ollama
  - 예: `ollama pull llama3.2:1b`
  - Ollama 서버 기본 주소: `http://127.0.0.1:11434`

## Repository Layout

- `out/`
  - 크롤러 원본 출력(JSON/CSV/MD)
  - 주요 파일
    - `out/fundraisings-now.json`
    - `out/goodneighbors-campaigns.json`
    - `out/happybean-donations.json`
- `processed/`
  - 웹이 읽는 가공 결과 및 캐시
  - `processed/campaigns.json`: 웹에서 fetch 하는 최종 데이터
  - `processed/cache.json`: LLM 가공 결과/에러/해시 캐시
- `scripts/`
  - `scripts/build-processed.js`: out -> processed 변환(정규화 + LLM 가공 + 캐시)
  - `scripts/llm-ollama.js`: Ollama API 어댑터(JSON 강제/검증/재시도)
- `server.js`
  - 정적 페이지 + `/api/campaigns`를 제공하는 간단 HTTP 서버

## Crawl (원본 데이터 수집)

이 프로젝트는 사이트별로 “브라우저 자동화 없이” 내부 API/HTML을 직접 호출해서 리스트를 수집합니다(가능한 경우).

### NPM scripts

- Kakao 같이기부
  - `npm run crawl:now:json`
  - `npm run crawl:now:csv`
  - `npm run crawl:now:md`
- GoodNeighbors
  - `npm run crawl:goodneighbors:json`
  - `npm run crawl:goodneighbors:csv`
  - `npm run crawl:goodneighbors:md`
- Happybean
  - `npm run crawl:happybean:json`
  - `npm run crawl:happybean:csv`
  - `npm run crawl:happybean:md`

## Build Processed (LLM 가공)

`npm run build:processed`는 다음을 수행합니다.

1. `out/*.json` 로드
2. 소스별 스키마를 공통 캠페인 스키마로 정규화
3. Ollama로 캠페인 메타데이터 생성
4. 결과를 `processed/cache.json`에 저장(증분/재시도 기반)
5. 웹용 최종 결과를 `processed/campaigns.json`으로 출력

### Output schema (processed/campaigns.json)

상위 구조:

```json
{
  "generatedAt": "2026-04-02T00:00:00.000Z",
  "model": "llama3.2:1b",
  "count": 123,
  "items": [
    {
      "uid": "kakao:123",
      "source": "kakao",
      "platform": "Kakao Together",
      "id": "123",
      "title": "...",
      "org": "...",
      "oneLineSummary": "...",
      "category": "...",
      "tags": ["..."],
      "link": "...",
      "donateLink": "...",
      "image": "...",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "amountCurrent": 0,
      "amountGoal": 0,
      "progressPct": 0,
      "donorsCount": 0,
      "state": "...",
      "raw": {
        "titleRaw": "...",
        "summaryRaw": "...",
        "categoryRaw": "..."
      }
    }
  ]
}
```

### Environment variables

- 공통
  - `RAW_DIR` (default: `./out`)
  - `OUT_DIR` (default: `./processed`)
  - `LLM_ENABLED` (default: `true`)
  - `OLLAMA_HOST` (default: `http://127.0.0.1:11434`)
  - `OLLAMA_MODEL` (default: `llama3.2:1b`)
- LLM 작업량/성능
  - `CONCURRENCY` (default: `2`)
  - `MAX_REFINE` (default: unlimited)
  - `CHECKPOINT_EVERY` (default: `10`)
- 선택 로직
  - `CHANGED_ONLY` (default: `true`)
  - `FORCE_REFINE` (default: `false`)
  - `RETRY_FAILED_ONLY` (default: `false`)

### Production-like run (전체 강제 가공)

```bash
OLLAMA_MODEL=llama3.2:1b FORCE_REFINE=true MAX_REFINE=2000 CONCURRENCY=2 CHECKPOINT_EVERY=10 npm run build:processed
```

### 실패 항목만 재가공

```bash
OLLAMA_MODEL=llama3.2:1b RETRY_FAILED_ONLY=true npm run build:processed
```

작은 모델은 간헐적으로 빈 값/영문 혼입 등을 내보낼 수 있어, 재시도를 여러 번 돌리면 성공 개수가 늘어날 수 있습니다.

## Run Website

```bash
npm start
```

라우팅:

- `/` -> `index.html` (메인)
- `/main_service.html` (캠페인 탐색 UI)
- `/api/campaigns` -> `processed/campaigns.json`

## CLI

`bin/cli.js`는 수집용 CLI입니다.

```bash
node bin/cli.js --help
```

예시:

```bash
node bin/cli.js now --format json --out out/fundraisings-now.json
node bin/cli.js goodneighbors --format json --out out/goodneighbors-campaigns.json
node bin/cli.js happybean --format json --out out/happybean-donations.json
```

## Testing

```bash
npm test
```

## Notes / Safety

- 이 프로젝트는 “공개된 캠페인 목록 데이터”만 수집/가공합니다.
- LLM 가공은 캐시를 사용합니다. 결과가 마음에 들지 않으면 `FORCE_REFINE=true`로 전체 재생성할 수 있습니다.
