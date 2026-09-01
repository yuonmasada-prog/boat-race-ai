(function attachBoatRaceHistory(root, factory) {
  const core = typeof module === 'object' && module.exports
    ? require('./lib/boat-race-core')
    : root.BoatRaceCore;
  const api = factory(core);

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BoatRaceHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistory(core) {
  'use strict';

  const STORAGE_KEY = 'boat-race-ai.predictions.v1';
  const CLIENT_KEY = 'boat-race-ai.client-id.v1';

  function clientId(storage) {
    const existing = storage?.getItem(CLIENT_KEY);
    if (/^[a-zA-Z0-9-]{24,80}$/.test(existing || '')) return existing;
    const generated = globalThis.crypto?.randomUUID?.() ||
      `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    storage?.setItem(CLIENT_KEY, generated);
    return generated;
  }

  function load(storage) {
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save(storage, records) {
    const trimmed = records.slice(-500);
    storage?.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  function upsert(storage, record) {
    const records = load(storage);
    const index = records.findIndex(item => item.predictionId === record.predictionId);

    if (index >= 0) records[index] = record;
    else records.push(record);

    return save(storage, records);
  }

  function mergeRecords(localRecords, remoteRecords) {
    const merged = new Map();
    for (const record of [...(localRecords || []), ...(remoteRecords || [])]) {
      if (!record?.predictionId) continue;
      const previous = merged.get(record.predictionId);
      if (!previous) {
        merged.set(record.predictionId, record);
        continue;
      }
      const preferRecord =
        (record.status === 'SETTLED' && previous.status !== 'SETTLED') ||
        (record.status === previous.status &&
          String(record.settledAt || record.timestamp || '') >= String(previous.settledAt || previous.timestamp || ''));
      if (preferRecord) merged.set(record.predictionId, record);
    }
    return [...merged.values()]
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
      .slice(-500);
  }

  async function pushRemote(storage, fetchImpl, records = load(storage)) {
    if (typeof fetchImpl !== 'function' || !records.length) return { ok: false, fallback: true };
    const id = clientId(storage);
    let saved = 0;
    try {
      for (let index = 0; index < records.length; index += 50) {
        const chunk = records.slice(index, index + 50);
        const response = await fetchImpl('/api/predictions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-client-id': id },
          body: JSON.stringify({ records: chunk })
        });
        if (!response.ok) return { ok: false, fallback: true, status: response.status, saved };
        saved += chunk.length;
      }
      return { ok: true, saved };
    } catch {
      return { ok: false, fallback: true, saved };
    }
  }

  async function syncRemote(storage, fetchImpl) {
    if (typeof fetchImpl !== 'function') return { ok: false, fallback: true, records: load(storage) };
    const id = clientId(storage);
    try {
      const response = await fetchImpl('/api/predictions?limit=500', {
        cache: 'no-store',
        headers: { 'x-client-id': id }
      });
      if (!response.ok) return { ok: false, fallback: true, status: response.status, records: load(storage) };
      const payload = await response.json();
      const records = mergeRecords(load(storage), Array.isArray(payload.records) ? payload.records : []);
      save(storage, records);
      const pushed = await pushRemote(storage, fetchImpl, records);
      return { ...pushed, records, persistence: payload.persistence || null };
    } catch {
      return { ok: false, fallback: true, records: load(storage) };
    }
  }

  function record(storage, input) {
    return upsert(storage, core.createPredictionRecord(input));
  }

  async function settlePending(storage, fetchImpl, options = {}) {
    const records = load(storage);
    const nowDate = String(options.today || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    let changed = false;

    for (let index = 0; index < records.length; index++) {
      const prediction = records[index];
      if (prediction.status === 'SETTLED' || prediction.date > nowDate) continue;

      try {
        const query = new URLSearchParams({
          date: prediction.date,
          venue: prediction.venue,
          race: String(prediction.race)
        });
        const response = await fetchImpl(`/api/result?${query}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const result = await response.json();
        if (!result.finished) continue;

        records[index] = core.settlePrediction(prediction, result);
        changed = true;
      } catch {
        // A transient result-source failure must leave the prediction pending.
      }
    }

    if (changed) save(storage, records);
    return records;
  }

  return {
    STORAGE_KEY,
    CLIENT_KEY,
    clientId,
    load,
    save,
    upsert,
    mergeRecords,
    record,
    settlePending,
    pushRemote,
    syncRemote,
    statistics: core.aggregateStatistics,
    segmentStatistics: core.aggregateSegmentStatistics,
    trainingDataset: core.buildTrainingDataset
  };
});
