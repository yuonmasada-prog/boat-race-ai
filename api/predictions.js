const { createPredictionStore, validateClientId } = require('../lib/storage/prediction-store');

const requests = globalThis.__BR_PREDICTION_REQUESTS__ || new Map();
globalThis.__BR_PREDICTION_REQUESTS__ = requests;

function allowRequest(clientId, now = Date.now()) {
  const previous = requests.get(clientId) || [];
  const recent = previous.filter(timestamp => now - timestamp < 60000);
  if (recent.length >= 30) return false;
  recent.push(now);
  requests.set(clientId, recent);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const store = createPredictionStore();

  if (!store) {
    return res.status(503).json({
      ok: false,
      error: 'prediction-store-not-configured',
      fallback: 'client-localStorage',
      requiredEnvironment: ['DATABASE_URL']
    });
  }

  const clientId = validateClientId(req.headers?.['x-client-id']);
  if (!clientId) return res.status(400).json({ ok: false, error: 'invalid-client-id' });
  if (!allowRequest(clientId)) return res.status(429).json({ ok: false, error: 'rate-limit' });

  try {
    if (req.method === 'GET') {
      const records = await store.list(clientId, Number(req.query?.limit || 500));
      return res.status(200).json({
        ok: true,
        persistence: store.kind,
        records
      });
    }

    if (req.method === 'POST') {
      const records = Array.isArray(req.body?.records)
        ? req.body.records
        : req.body?.prediction
          ? [req.body.prediction]
          : [];
      if (!records.length || records.length > 50) {
        return res.status(400).json({ ok: false, error: 'invalid-record-count' });
      }
      await store.upsertMany(clientId, records);
      return res.status(200).json({
        ok: true,
        persistence: store.kind,
        saved: records.length
      });
    }

    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  } catch (error) {
    const clientError = /^(invalid-|prediction-too-large)/.test(error?.message || '');
    return res.status(clientError ? 400 : 500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
};
