const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNowApiUrl,
  donationProgressPct,
  daysUntil,
  normalizeFundraisingRow,
  toMarkdown,
  toCsv,
} = require('../src/kakaoTogether');

const { parseCampaignListPage, buildCampaignListUrl } = require('../src/goodNeighbors');
const { buildRdonaBoxesUrl, progressPct } = require('../src/happybean');

test('buildNowApiUrl builds expected path and params', () => {
  const url = buildNowApiUrl({ baseUrl: 'https://together.kakao.com', page: 3, size: 10, seed: 14 });
  assert.ok(
    url.includes('https://together.kakao.com/fundraisings/api/fundraisings/api/v1/fundraisings/now'),
    'url should contain expected pathname'
  );
  assert.ok(url.includes('page=3'));
  assert.ok(url.includes('size=10'));
  assert.ok(url.includes('seed=14'));
});

test('donationProgressPct returns percent with 0.1 precision', () => {
  assert.equal(donationProgressPct(50, 200), 25);
  assert.ok(Math.abs(donationProgressPct(1, 3) - 33.3) < 0.2);
  assert.equal(donationProgressPct(null, 3), undefined);
});

test('daysUntil handles YYYY-MM-DD and returns integer', () => {
  const d = daysUntil('2099-01-01');
  assert.equal(Number.isInteger(d), true);
});

test('normalizeFundraisingRow outputs stable shape', () => {
  const out = normalizeFundraisingRow({
    id: 1,
    title: 't',
    subTopic: 's',
    teamName: 'team',
    fundraisingStartAt: '2026-01-01',
    fundraisingEndAt: '2099-01-01',
    totalDonationAmount: 1000,
    targetAmount: 2000,
    totalDonatorCount: 10,
    status: 'STATUS_FUNDING',
    mainImageUrl: 'https://example.com/a.jpg',
  });
  assert.equal(out.id, 1);
  assert.equal(out.title, 't');
  assert.equal(out.teamName, 'team');
  assert.equal(out.link, 'https://together.kakao.com/fundraisings/1/story');
  assert.equal(out.progressPct, 50);
});

test('toMarkdown and toCsv include expected headers', () => {
  const items = [
    {
      id: 1,
      title: 'hello',
      subTopic: 'topic',
      teamName: 'team',
      fundraisingEndAt: '2099-01-01',
      daysLeft: 10,
      totalDonationAmount: 100,
      targetAmount: 200,
      progressPct: 50,
      totalDonatorCount: 3,
      link: 'https://together.kakao.com/fundraisings/1/story',
    },
  ];
  const md = toMarkdown(items);
  assert.ok(md.includes('| # | 제목 |'));
  assert.ok(md.includes('hello'));

  const csv = toCsv(items);
  assert.ok(csv.split('\n')[0].includes('id,title,teamName'));
  assert.ok(csv.includes('hello'));
});

test('GoodNeighbors: parseCampaignListPage extracts items and lastPage', () => {
  const html = `
    <div class="gall_list typeB tab1">
      <ul class="gall_ul">
        <li class="gall_li">
          <ul class="gall_con">
            <li class="gall_img">
              <i class="icon icon_state">진행중</i>
              <a href="/campaign/abc"><img src="https://cdn.example/img.jpg" alt="alt" /></a>
            </li>
            <li class="gall_txt">
              <div class="gall_sort"><span>국내 위기가정지원 캠페인</span></div>
              <h2 class="gall_tit"><a href="/campaign/abc">선 넘는 좋은 일</a></h2>
              <p class="gall_stxt">요약<br/>줄2</p>
              <div class="btn_wrap gall_btn_wrap">
                <a class="btn btn_green" href="/support_pay/regular.gn?campaignCode=1">정기후원하기</a>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </div>
    <div class="pagination_wrap"><div class="pagination"><ul>
      <li><a href="javascript:fnObj.pageSubmit(1);">1</a></li>
      <li><a href="javascript:fnObj.pageSubmit(3);">3</a></li>
      <li><a href="javascript:fnObj.pageSubmit(2);">2</a></li>
    </ul></div></div>
    <input id="totalCount" name="totalCount" value="35"/>
  `;
  const parsed = parseCampaignListPage(html, { baseUrl: 'https://www.goodneighbors.kr' });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.lastPage, 3);
  assert.equal(parsed.totalCount, 35);
  assert.equal(parsed.items[0].title, '선 넘는 좋은 일');
  assert.equal(parsed.items[0].state, '진행중');
  assert.equal(parsed.items[0].detailUrl, 'https://www.goodneighbors.kr/campaign/abc');
  assert.equal(parsed.items[0].donateUrl, 'https://www.goodneighbors.kr/support_pay/regular.gn?campaignCode=1');
  assert.equal(parsed.items[0].summary, '요약\n줄2');
});

test('GoodNeighbors: buildCampaignListUrl includes expected params', () => {
  const url = buildCampaignListUrl({
    baseUrl: 'https://www.goodneighbors.kr',
    closeYn: 'N',
    pageNo: 2,
    totalCount: 35,
    bizGb: '',
    filter: '',
  });
  assert.ok(url.includes('campaignList.gn'));
  assert.ok(url.includes('closeYn=N'));
  assert.ok(url.includes('pageNo=2'));
  assert.ok(url.includes('totalCount=35'));
});

test('Happybean: buildRdonaBoxesUrl includes expected params', () => {
  const url = buildRdonaBoxesUrl({
    baseUrl: 'https://happybean.naver.com',
    begin: 1,
    end: 20,
    order: 'rcmd_ymdt',
    sortType: 'desc',
    onlyDouble: false,
    lgCatNo: 0,
    supportNo: 0,
  });
  assert.ok(url.includes('/rdona-service/rdona/rdonaboxes'));
  assert.ok(url.includes('begin=1'));
  assert.ok(url.includes('end=20'));
  assert.ok(url.includes('order=rcmd_ymdt'));
  assert.ok(url.includes('sortType=desc'));
});

test('Happybean: progressPct caps at 100 and floors', () => {
  assert.equal(progressPct(50, 200), 25);
  assert.equal(progressPct(199, 200), 99);
  assert.equal(progressPct(200, 200), 100);
  assert.equal(progressPct(500, 200), 100);
  assert.equal(progressPct(null, 200), undefined);
});
