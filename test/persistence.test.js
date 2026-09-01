const test = require('node:test');
const assert = require('node:assert/strict');
const predictionHandler = require('../api/predictions');
const settleHandler = require('../api/settle-predictions');
const {
  MemoryPredictionStore,
  _memoryNamespaces
} = require('../lib/storage/prediction-store');

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

function fixture(id = 'prediction-fixture') {
  return {
    predictionId: id,
    timestamp: '2026-09-01T01:00:00.000Z',
    date: '20260901',
    venue: '18',
    race: 2,
    decision: 'BET',
    status: 'PENDING',
    tickets: []
  };
}

test('memory prediction store isolates clients and lists pending records', async () => {
  _memoryNamespaces.clear();
  const store = new MemoryPredictionStore();
  const firstClient = '11111111-1111-4111-8111-111111111111';
  const secondClient = '22222222-2222-4222-8222-222222222222';
  await store.upsert(firstClient, fixture('prediction-one'));
  await store.upsert(secondClient, fixture('prediction-two'));

  assert.equal((await store.list(firstClient)).length, 1);
  assert.equal((await store.listPendingGlobal()).length, 2);
});

test('prediction API saves and retrieves a client namespace in memory mode', async () => {
  _memoryNamespaces.clear();
  const previousMode = process.env.PREDICTION_STORE_MODE;
  process.env.PREDICTION_STORE_MODE = 'memory';
  const clientId = '33333333-3333-4333-8333-333333333333';
  try {
    const post = responseRecorder();
    await predictionHandler({
      method: 'POST', headers: { 'x-client-id': clientId },
      body: { prediction: fixture('prediction-api') }
    }, post);
    assert.equal(post.statusCode, 200);
    assert.equal(post.body.saved, 1);

    const get = responseRecorder();
    await predictionHandler({ method: 'GET', headers: { 'x-client-id': clientId }, query: {} }, get);
    assert.equal(get.statusCode, 200);
    assert.equal(get.body.records[0].predictionId, 'prediction-api');
  } finally {
    if (previousMode === undefined) delete process.env.PREDICTION_STORE_MODE;
    else process.env.PREDICTION_STORE_MODE = previousMode;
  }
});

test('settlement cron fails closed without its bearer secret', async () => {
  const previousSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const res = responseRecorder();
    await settleHandler({ headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'unauthorized');
  } finally {
    if (previousSecret !== undefined) process.env.CRON_SECRET = previousSecret;
  }
});
