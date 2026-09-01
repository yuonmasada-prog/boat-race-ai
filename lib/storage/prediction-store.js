'use strict';

const { neon } = require('@neondatabase/serverless');

const memoryNamespaces = new Map();

function validateClientId(value) {
  const clientId = String(value || '').trim();
  return /^[a-zA-Z0-9-]{24,80}$/.test(clientId) ? clientId : null;
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('invalid-prediction');
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(String(record.predictionId || ''))) {
    throw new Error('invalid-prediction-id');
  }
  if (!/^\d{8}$/.test(String(record.date || ''))) throw new Error('invalid-date');
  if (!/^\d{2}$/.test(String(record.venue || ''))) throw new Error('invalid-venue');
  if (!Number.isInteger(Number(record.race)) || Number(record.race) < 1 || Number(record.race) > 12) {
    throw new Error('invalid-race');
  }
  if (!['BET', 'SKIP'].includes(record.decision)) throw new Error('invalid-decision');
  if (!['PENDING', 'SETTLED'].includes(record.status)) throw new Error('invalid-status');
  if (JSON.stringify(record).length > 75000) throw new Error('prediction-too-large');
  return record;
}

class MemoryPredictionStore {
  constructor() {
    this.kind = 'memory';
    this.persistent = false;
  }

  async ensureSchema() {}

  async upsert(clientId, record) {
    const validClientId = validateClientId(clientId);
    if (!validClientId) throw new Error('invalid-client-id');
    const validRecord = validateRecord(record);
    const namespace = memoryNamespaces.get(validClientId) || new Map();
    namespace.set(validRecord.predictionId, JSON.parse(JSON.stringify(validRecord)));
    memoryNamespaces.set(validClientId, namespace);
    return validRecord;
  }

  async upsertMany(clientId, records) {
    const output = [];
    for (const record of records) output.push(await this.upsert(clientId, record));
    return output;
  }

  async list(clientId, limit = 500) {
    const validClientId = validateClientId(clientId);
    if (!validClientId) throw new Error('invalid-client-id');
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 500));
    return [...(memoryNamespaces.get(validClientId)?.values() || [])]
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .slice(-safeLimit);
  }

  async listPendingGlobal(limit = 100) {
    const output = [];
    for (const [clientId, namespace] of memoryNamespaces.entries()) {
      for (const record of namespace.values()) {
        if (record.status !== 'SETTLED') output.push({ clientId, record });
      }
    }
    return output.slice(0, limit);
  }
}

class NeonPredictionStore {
  constructor(databaseUrl) {
    this.kind = 'neon-postgres';
    this.persistent = true;
    this.sql = neon(databaseUrl);
    this.schemaPromise = null;
  }

  async ensureSchema() {
    if (!this.schemaPromise) {
      this.schemaPromise = this.sql`
        CREATE TABLE IF NOT EXISTS boat_race_predictions (
          client_id TEXT NOT NULL,
          prediction_id TEXT NOT NULL,
          race_date CHAR(8) NOT NULL,
          venue CHAR(2) NOT NULL,
          race SMALLINT NOT NULL,
          decision TEXT NOT NULL,
          status TEXT NOT NULL,
          predicted_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL,
          PRIMARY KEY (client_id, prediction_id)
        )
      `;
    }
    await this.schemaPromise;
    await this.sql`
      CREATE INDEX IF NOT EXISTS boat_race_predictions_pending_idx
      ON boat_race_predictions (status, race_date)
    `;
  }

  async upsert(clientId, record) {
    const validClientId = validateClientId(clientId);
    if (!validClientId) throw new Error('invalid-client-id');
    const validRecord = validateRecord(record);
    await this.ensureSchema();
    const payload = JSON.stringify(validRecord);

    await this.sql`
      INSERT INTO boat_race_predictions (
        client_id, prediction_id, race_date, venue, race,
        decision, status, predicted_at, updated_at, payload
      ) VALUES (
        ${validClientId}, ${validRecord.predictionId}, ${validRecord.date},
        ${validRecord.venue}, ${Number(validRecord.race)}, ${validRecord.decision},
        ${validRecord.status}, ${validRecord.timestamp}, NOW(), ${payload}::jsonb
      )
      ON CONFLICT (client_id, prediction_id) DO UPDATE SET
        race_date = EXCLUDED.race_date,
        venue = EXCLUDED.venue,
        race = EXCLUDED.race,
        decision = EXCLUDED.decision,
        status = EXCLUDED.status,
        predicted_at = EXCLUDED.predicted_at,
        updated_at = NOW(),
        payload = EXCLUDED.payload
    `;
    return validRecord;
  }

  async upsertMany(clientId, records) {
    const output = [];
    for (const record of records) output.push(await this.upsert(clientId, record));
    return output;
  }

  async list(clientId, limit = 500) {
    const validClientId = validateClientId(clientId);
    if (!validClientId) throw new Error('invalid-client-id');
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload
      FROM boat_race_predictions
      WHERE client_id = ${validClientId}
      ORDER BY predicted_at DESC
      LIMIT ${Math.min(500, Math.max(1, Number(limit) || 500))}
    `;
    return rows.map(row => row.payload).reverse();
  }

  async listPendingGlobal(limit = 100) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT client_id, payload
      FROM boat_race_predictions
      WHERE status = 'PENDING'
        AND race_date <= ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}
      ORDER BY race_date ASC, predicted_at ASC
      LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}
    `;
    return rows.map(row => ({ clientId: row.client_id, record: row.payload }));
  }
}

function createPredictionStore(env = process.env) {
  if (env.DATABASE_URL) return new NeonPredictionStore(env.DATABASE_URL);
  if (env.PREDICTION_STORE_MODE === 'memory' || env.NODE_ENV === 'test') {
    return new MemoryPredictionStore();
  }
  return null;
}

module.exports = {
  createPredictionStore,
  validateClientId,
  validateRecord,
  MemoryPredictionStore,
  NeonPredictionStore,
  _memoryNamespaces: memoryNamespaces
};
