(function attachBoatRaceCore(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BoatRaceCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  'use strict';

  const UNIT = 100;

  function generateTrifectaKeys() {
    const keys = [];

    for (let first = 1; first <= 6; first++) {
      for (let second = 1; second <= 6; second++) {
        for (let third = 1; third <= 6; third++) {
          if (new Set([first, second, third]).size === 3) {
            keys.push(`${first}-${second}-${third}`);
          }
        }
      }
    }

    return keys;
  }

  const TRIFECTA_KEYS = Object.freeze(generateTrifectaKeys());
  const TRIFECTA_KEY_SET = new Set(TRIFECTA_KEYS);

  function canonicalTrifectaKey(value) {
    const text = Array.isArray(value)
      ? value.join('-')
      : String(value ?? '').trim();
    const digits = text.match(/[1-6]/g);

    if (!digits || digits.length !== 3 || new Set(digits).size !== 3) {
      return null;
    }

    return `${digits[0]}-${digits[1]}-${digits[2]}`;
  }

  function isCanonicalTrifectaKey(value) {
    return typeof value === 'string' && TRIFECTA_KEY_SET.has(value);
  }

  function canonicalBetCombination(value, betType = 'trifecta') {
    if (betType === 'trifecta') return canonicalTrifectaKey(value);

    const digits = String(value ?? '').match(/[1-6]/g);
    const expected = betType === 'trio' ? 3 : 2;

    if (!digits || digits.length !== expected || new Set(digits).size !== expected) {
      return null;
    }

    if (betType === 'trio' || betType === 'quinella') {
      return [...digits].sort().join('=');
    }

    if (betType === 'exacta') return digits.join('-');
    return null;
  }

  function marketProbabilities(odds) {
    const inverse = {};
    let total = 0;

    for (const [combination, rawOdd] of Object.entries(odds || {})) {
      const odd = Number(rawOdd);

      if (isCanonicalTrifectaKey(combination) && Number.isFinite(odd) && odd > 0) {
        inverse[combination] = 1 / odd;
        total += inverse[combination];
      }
    }

    const output = {};

    if (total <= 0) return output;

    for (const [combination, value] of Object.entries(inverse)) {
      output[combination] = value / total;
    }

    return output;
  }

  function validateTrifectaOdds(odds, options = {}) {
    const expectedCount = options.expectedCount ?? TRIFECTA_KEYS.length;
    const maxOdd = options.maxOdd ?? 10000;
    const extremeOdd = options.extremeOdd ?? 1000;
    const validOdds = {};
    const invalidKeys = [];
    const invalidValues = [];
    const extremeValues = [];

    for (const [key, rawValue] of Object.entries(odds || {})) {
      if (!isCanonicalTrifectaKey(key)) {
        invalidKeys.push(key);
        continue;
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value) || value < 1 || value > maxOdd) {
        invalidValues.push({ combination: key, value: rawValue });
        continue;
      }

      validOdds[key] = value;

      if (value >= extremeOdd) {
        extremeValues.push({ combination: key, value });
      }
    }

    const missing = TRIFECTA_KEYS.filter(key => !(key in validOdds));
    const validCount = Object.keys(validOdds).length;
    const coverage = expectedCount > 0
      ? Math.min(1, validCount / expectedCount)
      : 0;
    const usable =
      validCount === expectedCount &&
      invalidKeys.length === 0 &&
      invalidValues.length === 0;
    const warnings = [];
    const errors = [];

    if (validCount < expectedCount) {
      errors.push(`3連単オッズ不足: ${validCount}/${expectedCount}`);
    }
    if (invalidKeys.length) {
      errors.push(`非canonicalキー: ${invalidKeys.length}件`);
    }
    if (invalidValues.length) {
      errors.push(`異常オッズ: ${invalidValues.length}件`);
    }
    if (extremeValues.length) {
      warnings.push(`高オッズ警告: ${extremeValues.length}件`);
    }
    if (
      options.rawCount != null &&
      Number(options.rawCount) !== expectedCount
    ) {
      warnings.push(`raw取得件数: ${Number(options.rawCount)}/${expectedCount}`);
    }

    return {
      usable,
      status: usable ? 'complete' : validCount ? 'insufficient' : 'unavailable',
      score: Math.round(coverage * 100),
      expectedCount,
      validCount,
      missingCount: missing.length,
      missing,
      invalidKeys,
      invalidValues,
      extremeValues,
      warnings,
      errors,
      validOdds
    };
  }

  function freshnessScore(fetchedAt, maxAgeMs, now = Date.now()) {
    if (!fetchedAt || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return 1;
    const age = Math.max(0, now - new Date(fetchedAt).getTime());
    if (!Number.isFinite(age)) return 0;
    return Math.max(0, Math.min(1, 1 - age / maxAgeMs));
  }

  function calculateDataQuality(components, options = {}) {
    let weightedScore = 0;
    let totalWeight = 0;
    const sources = {};

    for (const [name, raw] of Object.entries(components || {})) {
      const component = raw || {};
      const weight = Math.max(0, Number(component.weight ?? 1));
      const completeness = Math.max(
        0,
        Math.min(1, 1 - Number(component.missingRate ?? (component.ok ? 0 : 1)))
      );
      const fresh = freshnessScore(
        component.fetchedAt,
        component.maxAgeMs,
        options.now ?? Date.now()
      );
      const score = component.ok ? completeness * fresh : 0;

      totalWeight += weight;
      weightedScore += score * weight;
      sources[name] = {
        ok: Boolean(component.ok),
        fetchedAt: component.fetchedAt || null,
        missingRate: Number((1 - completeness).toFixed(4)),
        freshness: Number(fresh.toFixed(4)),
        score: Math.round(score * 100)
      };
    }

    const score = totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0;

    return {
      score,
      status: score >= 90 ? 'good' : score >= 75 ? 'degraded' : 'poor',
      sufficient: score >= Number(options.minimumScore ?? 85),
      sources
    };
  }

  function fractionalKelly(probability, odds, fraction = 0.25) {
    const p = Number(probability);
    const decimalOdds = Number(odds);

    if (!Number.isFinite(p) || !Number.isFinite(decimalOdds) || p <= 0 || p >= 1 || decimalOdds <= 1) {
      return 0;
    }

    const fullKelly = (p * decimalOdds - 1) / (decimalOdds - 1);
    return Math.max(0, fullKelly) * Math.max(0, Math.min(1, Number(fraction)));
  }

  function allocateStakes(candidates, budget, options = {}) {
    const availableBudget = Math.floor(Number(budget) / UNIT) * UNIT;
    if (!Number.isFinite(availableBudget) || availableBudget < UNIT) return [];

    const minimumEv = Number(options.minimumEv ?? 1.03);
    const minimumEdgeRatio = Number(options.minimumEdgeRatio ?? 1.03);
    const minimumConfidence = Number(options.minimumConfidence ?? 0.7);
    const maxBets = Math.max(1, Math.floor(options.maxBets ?? 3));
    const kellyFraction = Number(options.kellyFraction ?? 0.25);
    const raceCap = Math.min(
      availableBudget,
      Math.max(UNIT, Math.floor(availableBudget * Number(options.maxRaceFraction ?? 0.3) / UNIT) * UNIT),
      options.maxAbsoluteStake != null && Number.isFinite(Number(options.maxAbsoluteStake))
        ? Math.max(0, Math.floor(Number(options.maxAbsoluteStake) / UNIT) * UNIT)
        : availableBudget
    );
    const perBetCap = Math.min(
      raceCap,
      Math.max(UNIT, Math.floor(availableBudget * Number(options.maxBetFraction ?? 0.15) / UNIT) * UNIT)
    );

    const ranked = (candidates || [])
      .map(candidate => {
        const rawPredictedProbability = Number(
          candidate.predictedProbability ?? candidate.p ?? 0
        );
        const marketProbability = Number(
          candidate.marketProbability ?? candidate.marketP ?? 0
        );
        const odds = Number(candidate.odds ?? candidate.odd);
        const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 1)));
        const calibrationShrink = Math.max(
          0,
          Math.min(1, Number(options.calibrationShrink ?? 0.5))
        );
        const predictedProbability = marketProbability > 0
          ? marketProbability +
            (rawPredictedProbability - marketProbability) * calibrationShrink * confidence
          : rawPredictedProbability * confidence;
        const ev = predictedProbability * odds;
        const edgeRatio = marketProbability > 0
          ? predictedProbability / marketProbability
          : 0;
        const kelly = fractionalKelly(predictedProbability, odds, kellyFraction) * confidence;

        const betType = candidate.betType || 'trifecta';

        return {
          ...candidate,
          betType,
          combination: canonicalBetCombination(
            candidate.combination ?? candidate.combo,
            betType
          ),
          predictedProbability,
          p: predictedProbability,
          rawPredictedProbability,
          marketProbability,
          marketP: marketProbability,
          odds,
          odd: odds,
          ev,
          edgeRatio,
          confidence,
          kelly,
          calibrationMethod: 'market-shrink-v1'
        };
      })
      .filter(candidate =>
        candidate.combination &&
        Number.isFinite(candidate.odds) &&
        candidate.odds > 1 &&
        candidate.ev >= minimumEv &&
        candidate.edgeRatio >= minimumEdgeRatio &&
        candidate.confidence >= minimumConfidence &&
        candidate.kelly > 0
      )
      .sort((a, b) => (b.kelly - a.kelly) || (b.ev - a.ev))
      .slice(0, maxBets);

    if (!ranked.length) return [];

    const totalWeight = ranked.reduce((sum, item) => sum + item.kelly, 0);
    let remaining = raceCap;

    return ranked
      .map((item, index) => {
        const remainingSlots = ranked.length - index;
        const proportional = totalWeight > 0
          ? Math.floor((raceCap * item.kelly / totalWeight) / UNIT) * UNIT
          : UNIT;
        const reserved = Math.max(0, (remainingSlots - 1) * UNIT);
        const stake = Math.min(
          perBetCap,
          Math.max(UNIT, proportional),
          Math.max(0, remaining - reserved)
        );

        remaining -= stake;

        return {
          ...item,
          combination: canonicalBetCombination(item.combination, item.betType),
          stake,
          amount: stake
        };
      })
      .filter(item => item.stake >= UNIT);
  }

  function decideSkip({ oddsQuality, dataQuality, tickets, minimumDataQuality = 85 }) {
    const reasons = [];

    if (!oddsQuality?.usable) reasons.push('odds-quality-insufficient');
    if (!dataQuality || dataQuality.score < minimumDataQuality) reasons.push('data-quality-insufficient');
    if (!Array.isArray(tickets) || tickets.length === 0) reasons.push('no-positive-ev-ticket');

    return {
      skip: reasons.length > 0,
      decision: reasons.length ? 'SKIP' : 'BET',
      reasons
    };
  }

  function raceCode(date, venue, race) {
    return `${String(date).replace(/[-/]/g, '')}${String(venue).padStart(2, '0')}${String(race).padStart(2, '0')}`;
  }

  function createPredictionRecord(input) {
    const timestamp = input.timestamp || new Date().toISOString();
    const date = String(input.date || '').replace(/[-/]/g, '');
    const venue = String(input.venue || '').padStart(2, '0');
    const race = Number(input.race);
    const code = input.raceCode || raceCode(date, venue, race);
    const tickets = (input.tickets || input.picks || []).map(ticket => ({
      betType: ticket.betType || 'trifecta',
      betTypeLabel: ticket.betTypeLabel || null,
      combination: canonicalBetCombination(
        ticket.combination ?? ticket.combo,
        ticket.betType || 'trifecta'
      ),
      predictedProbability: Number(ticket.predictedProbability ?? ticket.p ?? 0),
      marketProbability: Number(ticket.marketProbability ?? ticket.marketP ?? 0),
      odds: Number(ticket.odds ?? ticket.odd ?? 0),
      ev: Number(ticket.ev ?? ((ticket.predictedProbability ?? ticket.p ?? 0) * (ticket.odds ?? ticket.odd ?? 0))),
      confidence: Number(ticket.confidence ?? input.confidence ?? 0),
      stake: Math.max(0, Math.floor(Number(ticket.stake ?? ticket.amount ?? 0) / UNIT) * UNIT),
      hit: null,
      returnAmount: null,
      profitLoss: null
    })).filter(ticket => ticket.combination);

    return {
      predictionId: input.predictionId || `${code}-${Date.parse(timestamp).toString(36)}`,
      timestamp,
      date,
      venue,
      venueName: input.venueName || null,
      race,
      raceCode: code,
      modelVersion: input.modelVersion || 'unknown',
      decision: input.decision || (tickets.length ? 'BET' : 'SKIP'),
      reason: input.reason || null,
      confidence: Number(input.confidence ?? 0),
      dataQuality: input.dataQuality || null,
      snapshot: input.snapshot || null,
      oddsSnapshot: input.oddsSnapshot || null,
      tickets,
      status: 'PENDING',
      actualResult: null,
      payout: null,
      hit: null,
      returnAmount: null,
      profitLoss: null,
      settledAt: null
    };
  }

  function settlePrediction(record, result, settledAt = new Date().toISOString()) {
    if (!result?.finished) return { ...record };

    const actualResult = canonicalTrifectaKey(result.result ?? result.actualResult);
    const payout = Number(result.payout);

    if (!actualResult || !Number.isFinite(payout) || payout < 0) return { ...record };

    const tickets = (record.tickets || []).map(ticket => {
      const stake = Number(ticket.stake || 0);
      const betType = ticket.betType || 'trifecta';
      const payoutInfo = result.payouts?.[betType] || (
        betType === 'trifecta'
          ? { combination: actualResult, amount: payout }
          : null
      );
      const settledCombination = canonicalBetCombination(
        payoutInfo?.combination,
        betType
      );
      const ticketCombination = canonicalBetCombination(ticket.combination, betType);
      const ticketPayout = Number(payoutInfo?.amount);
      const hit = Boolean(settledCombination && ticketCombination === settledCombination);
      const returnAmount = hit && Number.isFinite(ticketPayout)
        ? (stake / UNIT) * ticketPayout
        : 0;

      return {
        ...ticket,
        hit,
        returnAmount,
        profitLoss: returnAmount - stake
      };
    });
    const totalStake = tickets.reduce((sum, ticket) => sum + Number(ticket.stake || 0), 0);
    const returnAmount = tickets.reduce((sum, ticket) => sum + Number(ticket.returnAmount || 0), 0);
    const hit = tickets.some(ticket => ticket.hit);

    return {
      ...record,
      status: 'SETTLED',
      actualResult,
      payout,
      hit,
      returnAmount,
      profitLoss: returnAmount - totalStake,
      settledAt,
      resultSource: result.source || null,
      tickets
    };
  }

  function aggregateStatistics(records) {
    const list = Array.isArray(records) ? records : [];
    const bets = list.filter(record => record.decision === 'BET');
    const skips = list.filter(record => record.decision === 'SKIP');
    const settledBets = bets.filter(record => record.status === 'SETTLED');
    const hits = settledBets.filter(record => record.hit);
    const totalStake = settledBets.reduce(
      (sum, record) => sum + (record.tickets || []).reduce((ticketSum, ticket) => ticketSum + Number(ticket.stake || 0), 0),
      0
    );
    const totalReturn = settledBets.reduce((sum, record) => sum + Number(record.returnAmount || 0), 0);
    const outcomes = [];

    for (const record of settledBets) {
      for (const ticket of record.tickets || []) {
        const probability = Math.max(1e-9, Math.min(1 - 1e-9, Number(ticket.predictedProbability || 0)));
        const actual = ticket.hit ? 1 : 0;
        outcomes.push({ probability, actual });
      }
    }

    const brierScore = outcomes.length
      ? outcomes.reduce((sum, item) => sum + Math.pow(item.probability - item.actual, 2), 0) / outcomes.length
      : null;
    const logLoss = outcomes.length
      ? -outcomes.reduce(
          (sum, item) => sum + item.actual * Math.log(item.probability) + (1 - item.actual) * Math.log(1 - item.probability),
          0
        ) / outcomes.length
      : null;

    return {
      totalPredictions: list.length,
      betCount: bets.length,
      skipCount: skips.length,
      pendingCount: list.filter(record => record.status !== 'SETTLED').length,
      settledBetCount: settledBets.length,
      hitCount: hits.length,
      hitRate: settledBets.length ? hits.length / settledBets.length : 0,
      totalStake,
      totalReturn,
      profitLoss: totalReturn - totalStake,
      roi: totalStake ? totalReturn / totalStake : 0,
      brierScore,
      logLoss
    };
  }

  function aggregateSegmentStatistics(records) {
    const list = Array.isArray(records) ? records : [];
    const rows = [];

    for (const record of list) {
      if (record.decision !== 'BET' || record.status !== 'SETTLED') continue;
      const windSpeed = Number(
        record.snapshot?.weather?.windSpeed ??
        record.snapshot?.weather?.wind ??
        record.snapshot?.windSpeed
      );
      const windBand = !Number.isFinite(windSpeed)
        ? 'unknown'
        : windSpeed < 3
          ? '0-2m'
          : windSpeed < 6
            ? '3-5m'
            : '6m+';
      const hour = Number.isFinite(Date.parse(record.timestamp))
        ? Number(new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23'
          }).format(new Date(record.timestamp)))
        : null;
      const timeBand = hour === null
        ? 'unknown'
        : hour < 12
          ? 'morning'
          : hour < 17
            ? 'afternoon'
            : 'evening';

      for (const ticket of record.tickets || []) {
        const firstLane = Number(String(ticket.combination || '').match(/[1-6]/)?.[0]);
        const selectedRacer = (record.snapshot?.racers || []).find(
          racer => Number(racer.lane) === firstLane
        );
        const grade = record.snapshot?.raceGrade || record.snapshot?.grade || selectedRacer?.grade || 'unknown';
        const odds = Number(ticket.odds);
        const oddsBand = !Number.isFinite(odds)
          ? 'unknown'
          : odds < 10
            ? '<10'
            : odds < 30
              ? '10-29.9'
              : odds < 100
                ? '30-99.9'
                : '100+';
        rows.push({
          venue: record.venueName || record.venue || 'unknown',
          betType: ticket.betType || 'trifecta',
          oddsBand,
          windBand,
          grade,
          timeBand,
          lane1Role: String(ticket.combination || '').startsWith('1-')
            ? 'lane1-first'
            : String(ticket.combination || '').includes('1')
              ? 'lane1-included'
              : 'lane1-excluded',
          modelVersion: record.modelVersion || 'unknown',
          stake: Number(ticket.stake || 0),
          returnAmount: Number(ticket.returnAmount || 0),
          hit: Boolean(ticket.hit),
          probability: Math.max(
            1e-9,
            Math.min(1 - 1e-9, Number(ticket.predictedProbability || 0))
          )
        });
      }
    }

    function groupBy(field) {
      const groups = new Map();
      for (const row of rows) {
        const key = row[field];
        const group = groups.get(key) || [];
        group.push(row);
        groups.set(key, group);
      }

      return [...groups.entries()]
        .map(([segment, items]) => {
          const stake = items.reduce((sum, item) => sum + item.stake, 0);
          const returnAmount = items.reduce((sum, item) => sum + item.returnAmount, 0);
          const hits = items.filter(item => item.hit).length;
          const brierScore = items.reduce(
            (sum, item) => sum + Math.pow(item.probability - (item.hit ? 1 : 0), 2),
            0
          ) / items.length;
          return {
            segment,
            ticketCount: items.length,
            hitCount: hits,
            hitRate: hits / items.length,
            totalStake: stake,
            totalReturn: returnAmount,
            profitLoss: returnAmount - stake,
            roi: stake ? returnAmount / stake : 0,
            brierScore
          };
        })
        .sort((a, b) => (b.ticketCount - a.ticketCount) || String(a.segment).localeCompare(String(b.segment)));
    }

    return {
      settledTicketCount: rows.length,
      byVenue: groupBy('venue'),
      byBetType: groupBy('betType'),
      byOddsBand: groupBy('oddsBand'),
      byWindBand: groupBy('windBand'),
      byGrade: groupBy('grade'),
      byPredictionTime: groupBy('timeBand'),
      byLane1Role: groupBy('lane1Role'),
      byModelVersion: groupBy('modelVersion')
    };
  }

  function dailyRiskCapacity(records, date, dailyLossLimit) {
    const normalizedDate = String(date || '').replace(/[-/]/g, '');
    const limit = Math.max(0, Math.floor(Number(dailyLossLimit) / UNIT) * UNIT);
    let realizedLoss = 0;
    let pendingStake = 0;

    for (const record of Array.isArray(records) ? records : []) {
      if (record.date !== normalizedDate || record.decision !== 'BET') continue;
      const stake = (record.tickets || []).reduce(
        (sum, ticket) => sum + Number(ticket.stake || 0),
        0
      );
      if (record.status === 'SETTLED') {
        realizedLoss += Math.max(0, -Number(record.profitLoss || 0));
      } else {
        pendingStake += stake;
      }
    }

    return {
      limit,
      realizedLoss,
      pendingStake,
      remaining: Math.max(0, limit - realizedLoss - pendingStake)
    };
  }

  function oddsVolatility(previousOdds, currentOdds, options = {}) {
    const changes = [];
    for (const key of TRIFECTA_KEYS) {
      const previous = Number(previousOdds?.[key]);
      const current = Number(currentOdds?.[key]);
      if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0 || current <= 0) continue;
      changes.push(Math.abs(current - previous) / previous);
    }
    changes.sort((a, b) => a - b);
    const percentile = value => changes.length
      ? changes[Math.min(changes.length - 1, Math.floor((changes.length - 1) * value))]
      : null;
    const minimumSamples = Number(options.minimumSamples ?? 60);
    const threshold = Number(options.maximumP90Change ?? 0.35);
    const p90RelativeChange = percentile(0.9);
    return {
      sampleCount: changes.length,
      medianRelativeChange: percentile(0.5),
      p90RelativeChange,
      threshold,
      unstable: changes.length >= minimumSamples && p90RelativeChange > threshold
    };
  }

  function buildTrainingDataset(records) {
    return (Array.isArray(records) ? records : [])
      .filter(record => record.status === 'SETTLED' && record.actualResult)
      .map(record => ({
        predictionId: record.predictionId,
        predictionTimestamp: record.timestamp,
        date: record.date,
        venue: record.venue,
        race: record.race,
        raceCode: record.raceCode,
        modelVersion: record.modelVersion,
        decision: record.decision,
        confidence: record.confidence,
        dataQuality: record.dataQuality,
        featuresAtPrediction: record.snapshot,
        oddsAtPrediction: record.oddsSnapshot,
        ticketsAtPrediction: (record.tickets || []).map(ticket => ({
          betType: ticket.betType,
          combination: ticket.combination,
          predictedProbability: ticket.predictedProbability,
          marketProbability: ticket.marketProbability,
          odds: ticket.odds,
          ev: ticket.ev,
          confidence: ticket.confidence,
          stake: ticket.stake
        })),
        label: {
          actualResult: record.actualResult,
          payout: record.payout,
          hit: record.hit,
          returnAmount: record.returnAmount,
          profitLoss: record.profitLoss,
          settledAt: record.settledAt
        }
      }));
  }

  async function withRetry(operation, options = {}) {
    const attempts = Math.max(1, Math.floor(options.attempts ?? 2));
    const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 100));
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (attempt < attempts && retryDelayMs) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw lastError;
  }

  return {
    UNIT,
    TRIFECTA_KEYS,
    generateTrifectaKeys,
    canonicalTrifectaKey,
    isCanonicalTrifectaKey,
    canonicalBetCombination,
    marketProbabilities,
    validateTrifectaOdds,
    calculateDataQuality,
    fractionalKelly,
    allocateStakes,
    decideSkip,
    raceCode,
    createPredictionRecord,
    settlePrediction,
    aggregateStatistics,
    aggregateSegmentStatistics,
    dailyRiskCapacity,
    oddsVolatility,
    buildTrainingDataset,
    withRetry
  };
});
