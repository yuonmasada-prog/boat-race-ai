const core = require('../lib/boat-race-core');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      persistence: process.env.DATABASE_URL ? 'neon-postgres' : 'client-localStorage',
      actions: ['statistics', 'segments', 'settle', 'dataset'],
      warning: process.env.DATABASE_URL
        ? null
        : 'サーバー永続化にはDATABASE_URL設定が必要です。'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  const body = req.body || {};

  if (body.action === 'settle') {
    return res.status(200).json({
      ok: true,
      prediction: core.settlePrediction(body.prediction || {}, body.result || {})
    });
  }

  if (body.action === 'dataset') {
    return res.status(200).json({
      ok: true,
      dataset: core.buildTrainingDataset(
        Array.isArray(body.records) ? body.records : []
      ),
      leakageGuard: 'featuresAtPrediction and label are separated'
    });
  }

  if (body.action === 'segments') {
    return res.status(200).json({
      ok: true,
      segments: core.aggregateSegmentStatistics(
        Array.isArray(body.records) ? body.records : []
      )
    });
  }

  const records = Array.isArray(body.records) ? body.records : [];
  return res.status(200).json({
    ok: true,
    statistics: core.aggregateStatistics(records)
  });
};
