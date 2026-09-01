const core = require('../lib/boat-race-core');
const { createPredictionStore } = require('../lib/storage/prediction-store');
const resultInternals = require('./result')._internals;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers?.authorization;

  if (!secret || authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const store = createPredictionStore();
  if (!store?.persistent) {
    return res.status(503).json({ ok: false, error: 'persistent-store-not-configured' });
  }

  const started = Date.now();

  try {
    const pending = await store.listPendingGlobal(100);
    const dates = [...new Set(pending.map(item => item.record.date))].slice(0, 3);
    const dailyResults = new Map();

    const sourceErrors = [];
    await Promise.all(dates.map(async date => {
      const year = date.slice(0, 4);
      try {
        const data = await core.withRetry(
          () => resultInternals.fetchJson(
            `https://boatraceopenapi.github.io/api/v1/${year}/${date}.json`,
            7000
          ),
          { attempts: 2, retryDelayMs: 100 }
        );
        dailyResults.set(date, data);
      } catch (error) {
        sourceErrors.push({ date, error: error?.message || String(error) });
      }
    }));

    let settled = 0;

    for (const item of pending) {
      if (!dailyResults.has(item.record.date)) continue;
      const raceData = resultInternals.findRace(
        dailyResults.get(item.record.date),
        item.record.venue,
        item.record.race
      );
      const result = resultInternals.parseResult(raceData);
      if (!result.finished) continue;
      const updated = core.settlePrediction(item.record, {
        ...result,
        source: 'boatraceopenapi-v1'
      });
      await store.upsert(item.clientId, updated);
      settled++;
    }

    return res.status(200).json({
      ok: true,
      checked: pending.length,
      settled,
      sourceErrors,
      elapsedMs: Date.now() - started
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      elapsedMs: Date.now() - started
    });
  }
};
