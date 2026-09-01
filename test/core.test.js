const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/boat-race-core');

function completeOdds(value = 10) {
  return Object.fromEntries(core.TRIFECTA_KEYS.map((key, index) => [key, value + index / 10]));
}

test('canonical trifecta contract contains exactly 120 unique hyphenated keys', () => {
  assert.equal(core.TRIFECTA_KEYS.length, 120);
  assert.equal(new Set(core.TRIFECTA_KEYS).size, 120);
  assert.ok(core.TRIFECTA_KEYS.every(core.isCanonicalTrifectaKey));
  assert.equal(core.canonicalTrifectaKey('123'), '1-2-3');
  assert.equal(core.canonicalTrifectaKey('1=2=3'), '1-2-3');
  assert.equal(core.canonicalTrifectaKey('1-1-2'), null);
});

test('odds validation fails closed on missing, invalid, or noncanonical data', () => {
  const odds = completeOdds();
  assert.equal(core.validateTrifectaOdds(odds, { rawCount: 120 }).usable, true);

  delete odds['1-2-3'];
  odds['123'] = 0;
  const quality = core.validateTrifectaOdds(odds, { rawCount: 119 });
  assert.equal(quality.usable, false);
  assert.equal(quality.validCount, 119);
  assert.deepEqual(quality.invalidKeys, ['123']);
  assert.ok(quality.errors.length >= 2);
});

test('market probabilities are normalized', () => {
  const probabilities = core.marketProbabilities(completeOdds());
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
});

test('fractional Kelly allocation leaves budget unused and rejects negative EV', () => {
  const selected = core.allocateStakes([
    { combination: '1-2-3', predictedProbability: 0.12, marketProbability: 0.08, odds: 12, confidence: 0.95 },
    { combination: '1-3-2', predictedProbability: 0.08, marketProbability: 0.06, odds: 15, confidence: 0.9 },
    { combination: '2-1-3', predictedProbability: 0.02, marketProbability: 0.03, odds: 20, confidence: 0.9 }
  ], 1000);

  assert.equal(selected.length, 2);
  assert.ok(selected.every(ticket => ticket.ev > 1 && ticket.stake % 100 === 0));
  assert.ok(selected.reduce((sum, ticket) => sum + ticket.stake, 0) <= 300);
});

test('SKIP is mandatory for incomplete odds, weak data, or no positive-EV ticket', () => {
  const decision = core.decideSkip({
    oddsQuality: core.validateTrifectaOdds({}),
    dataQuality: { score: 70 },
    tickets: []
  });
  assert.equal(decision.skip, true);
  assert.deepEqual(decision.reasons, [
    'odds-quality-insufficient',
    'data-quality-insufficient',
    'no-positive-ev-ticket'
  ]);
});

test('prediction/result matching calculates payout, profit, ROI, Brier, and log loss', () => {
  const prediction = core.createPredictionRecord({
    predictionId: 'p1',
    date: '20260901',
    venue: '15',
    race: 1,
    modelVersion: 'fixture',
    tickets: [
      { combination: '1-2-3', predictedProbability: 0.1, marketProbability: 0.08, odds: 12, confidence: 0.9, stake: 200 },
      { combination: '1-3-2', predictedProbability: 0.08, marketProbability: 0.07, odds: 14, confidence: 0.9, stake: 100 }
    ]
  });
  const settled = core.settlePrediction(prediction, {
    finished: true,
    result: '1=2=3',
    payout: 1200,
    source: 'fixture'
  });
  const stats = core.aggregateStatistics([settled]);

  assert.equal(settled.actualResult, '1-2-3');
  assert.equal(settled.returnAmount, 2400);
  assert.equal(settled.profitLoss, 2100);
  assert.equal(stats.totalStake, 300);
  assert.equal(stats.roi, 8);
  assert.ok(Number.isFinite(stats.brierScore));
  assert.ok(Number.isFinite(stats.logLoss));

  const dataset = core.buildTrainingDataset([settled]);
  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].label.actualResult, '1-2-3');
  assert.equal(dataset[0].featuresAtPrediction?.actualResult, undefined);
});

test('multi-bet settlement uses the payout for each ticket type', () => {
  const prediction = core.createPredictionRecord({
    predictionId: 'multi',
    date: '20260901',
    venue: '18',
    race: 2,
    decision: 'BET',
    tickets: [
      { betType: 'trio', combination: '3-1-2', predictedProbability: 0.2, marketProbability: 0.15, odds: 4.5, stake: 100 },
      { betType: 'exacta', combination: '1=2', predictedProbability: 0.15, marketProbability: 0.1, odds: 6, stake: 100 }
    ]
  });
  const settled = core.settlePrediction(prediction, {
    finished: true,
    result: '1-2-3',
    payout: 1200,
    payouts: {
      trifecta: { combination: '1-2-3', amount: 1200 },
      trio: { combination: '1=2=3', amount: 450 },
      exacta: { combination: '1-2', amount: 600 }
    }
  });

  assert.equal(settled.tickets[0].hit, true);
  assert.equal(settled.tickets[0].returnAmount, 450);
  assert.equal(settled.tickets[1].hit, true);
  assert.equal(settled.tickets[1].returnAmount, 600);
  assert.equal(settled.returnAmount, 1050);
});

test('segment statistics expose venue, bet type, odds, wind, and model cohorts', () => {
  const prediction = core.createPredictionRecord({
    predictionId: 'segment-fixture',
    date: '20260901',
    venue: '18',
    venueName: '徳山',
    race: 2,
    modelVersion: 'v12',
    snapshot: { weather: { windSpeed: 4 }, racers: [{ lane: 1, grade: 'A1' }] },
    tickets: [
      { betType: 'trifecta', combination: '1-2-3', predictedProbability: 0.1, odds: 12, stake: 100 }
    ]
  });
  const settled = core.settlePrediction(prediction, {
    finished: true,
    result: '1-2-3',
    payout: 1200
  });
  const segments = core.aggregateSegmentStatistics([settled]);

  assert.equal(segments.settledTicketCount, 1);
  assert.equal(segments.byVenue[0].segment, '徳山');
  assert.equal(segments.byBetType[0].segment, 'trifecta');
  assert.equal(segments.byOddsBand[0].segment, '10-29.9');
  assert.equal(segments.byWindBand[0].segment, '3-5m');
  assert.equal(segments.byGrade[0].segment, 'A1');
  assert.equal(segments.byLane1Role[0].segment, 'lane1-first');
  assert.equal(segments.byModelVersion[0].segment, 'v12');
  assert.equal(segments.byVenue[0].roi, 12);
});

test('daily risk capacity reserves pending stakes and realized losses', () => {
  const records = [
    { date: '20260901', decision: 'BET', status: 'PENDING', tickets: [{ stake: 200 }] },
    { date: '20260901', decision: 'BET', status: 'SETTLED', profitLoss: -300, tickets: [{ stake: 300 }] },
    { date: '20260831', decision: 'BET', status: 'PENDING', tickets: [{ stake: 999 }] }
  ];
  assert.deepEqual(core.dailyRiskCapacity(records, '2026-09-01', 1000), {
    limit: 1000,
    realizedLoss: 300,
    pendingStake: 200,
    remaining: 500
  });
  const selected = core.allocateStakes([
    { combination: '1-2-3', predictedProbability: 0.2, marketProbability: 0.08, odds: 12, confidence: 1 }
  ], 1000, { maxAbsoluteStake: 100 });
  assert.equal(selected[0].stake, 100);
});

test('odds volatility gate detects broad last-minute repricing', () => {
  const previous = completeOdds(10);
  const stable = Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value * 1.05]));
  const unstable = Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value * 1.5]));
  assert.equal(core.oddsVolatility(previous, stable).unstable, false);
  assert.equal(core.oddsVolatility(previous, unstable).unstable, true);
  assert.equal(core.oddsVolatility({}, unstable).unstable, false);
});
