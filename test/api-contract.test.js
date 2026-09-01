const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const oddsHandler = require('../api/odds');
const predictHandler = require('../api/predict');
const resultHandler = require('../api/result');
const statisticsHandler = require('../api/statistics');
const scanHandler = require('../api/scan');
const core = require('../lib/boat-race-core');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('API endpoints reject invalid race parameters without upstream access', async () => {
  for (const handler of [oddsHandler, predictHandler, resultHandler]) {
    const res = responseRecorder();
    await handler({ query: { date: 'bad', venue: '99', race: 0 } }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('statistics API contract settles a prediction and aggregates records', async () => {
  const settleRes = responseRecorder();
  await statisticsHandler({
    method: 'POST',
    body: {
      action: 'settle',
      prediction: {
        predictionId: 'p1',
        decision: 'BET',
        tickets: [{ combination: '1-2-3', predictedProbability: 0.1, stake: 100 }]
      },
      result: { finished: true, result: '1-2-3', payout: 1000 }
    }
  }, settleRes);
  assert.equal(settleRes.statusCode, 200);
  assert.equal(settleRes.body.prediction.profitLoss, 900);

  const statsRes = responseRecorder();
  await statisticsHandler({ method: 'POST', body: { records: [settleRes.body.prediction] } }, statsRes);
  assert.equal(statsRes.body.statistics.roi, 10);

  const segmentsRes = responseRecorder();
  await statisticsHandler({ method: 'POST', body: { action: 'segments', records: [settleRes.body.prediction] } }, segmentsRes);
  assert.equal(segmentsRes.statusCode, 200);
  assert.equal(segmentsRes.body.segments.settledTicketCount, 1);
});

test('scanner uses the shared fail-closed 120-combination odds gate', () => {
  const completeRow = Object.fromEntries(
    core.TRIFECTA_KEYS.map(key => [`3連単_${key}`, 10])
  );
  const complete = scanHandler._internals.marketQuality(
    scanHandler._internals.oddsStats(completeRow)
  );
  assert.equal(complete.oddsQuality.usable, true);

  delete completeRow['3連単_1-2-3'];
  const incomplete = scanHandler._internals.marketQuality(
    scanHandler._internals.oddsStats(completeRow)
  );
  assert.equal(incomplete.pass, false);
  assert.equal(incomplete.oddsQuality.validCount, 119);
});

test('browser prediction path keeps canonical trifecta keys and the 120-row gate', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /`\$\{first\}-\$\{second\}-\$\{third\}`/);
  assert.doesNotMatch(html, /`\$\{first\}\$\{second\}\$\{third\}`/);
  assert.match(html, /oddsCount === 120/);
});

test('browser risk gates stay inside purchase decision instead of history persistence', () => {
  const html = readFileSync('index.html', 'utf8');
  const purchaseDecision = html.slice(
    html.indexOf('function purchaseDecision('),
    html.indexOf('function dataStatus(')
  );
  const saveHistory = html.slice(
    html.indexOf('function saveAnalysisHistory('),
    html.indexOf('function renderHistory(')
  );

  assert.match(purchaseDecision, /riskContext\.volatility\?\.unstable/);
  assert.match(purchaseDecision, /riskContext\.dailyRisk\?\.remaining < 100/);
  assert.doesNotMatch(saveHistory, /riskContext/);
});
