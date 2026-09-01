const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../history');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('browser history persists and automatically joins a finished result', async () => {
  const storage = memoryStorage();
  history.record(storage, {
    predictionId: 'fixture-prediction',
    date: '20260901',
    venue: '15',
    race: 1,
    decision: 'BET',
    tickets: [{ combination: '1-2-3', p: 0.1, marketP: 0.08, odds: 12, amount: 100 }]
  });

  const records = await history.settlePending(
    storage,
    async () => ({
      ok: true,
      json: async () => ({ finished: true, result: '1-2-3', payout: 1200, source: 'fixture' })
    }),
    { today: '2026-09-01' }
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'SETTLED');
  assert.equal(records[0].returnAmount, 1200);
  assert.equal(history.statistics(records).roi, 12);
});

test('remote history synchronization merges settled records and uploads the merged history', async () => {
  const storage = memoryStorage();
  const pending = {
    predictionId: 'remote-fixture', timestamp: '2026-09-01T01:00:00.000Z',
    date: '20260901', venue: '18', race: 2, decision: 'BET', status: 'PENDING', tickets: []
  };
  const settled = {
    ...pending, status: 'SETTLED', settledAt: '2026-09-01T10:00:00.000Z',
    actualResult: '1-2-3', hit: false, returnAmount: 0, profitLoss: -100
  };
  history.save(storage, [pending]);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) {
      return { ok: true, json: async () => ({ persistence: 'memory', records: [settled] }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const result = await history.syncRemote(storage, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.records[0].status, 'SETTLED');
  assert.match(calls[0].options.headers['x-client-id'], /^[a-zA-Z0-9-]{24,80}$/);
  assert.equal(JSON.parse(calls[1].options.body).records[0].status, 'SETTLED');
});
