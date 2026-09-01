const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/boat-race-core');
const odds = require('../api/odds')._internals;
const result = require('../api/result')._internals;

test('official odds parser maps all 120 cells to canonical keys', () => {
  const html = odds.ORDER
    .map((_, index) => `<td class="oddsPoint">${(2 + index / 10).toFixed(1)}</td>`)
    .join('');
  const parsed = odds.parseTrifecta(html);

  assert.equal(parsed.rawCount, 120);
  assert.equal(parsed.count, 120);
  assert.ok(Object.keys(parsed.odds).every(core.isCanonicalTrifectaKey));
  assert.equal(core.validateTrifectaOdds(parsed.odds, { rawCount: parsed.rawCount }).usable, true);
});

test('result parser canonicalizes trifecta and exposes all supported payouts', () => {
  const parsed = result.parseResult({
    result: {
      payouts: {
        trifecta: [{ combination: '1=2=3', amount: 1230 }],
        trio: [{ combination: '3-1-2', amount: 450 }],
        exacta: [{ combination: '1=2', amount: 320 }],
        quinella: [{ combination: '2-1', amount: 210 }]
      },
      racers: {
        1: { number: 1001, name: 'A', course_number: 1, start_timing: 0.12, place_number: 1 },
        2: { number: 1002, name: 'B', course_number: 2, start_timing: 0.14, place_number: 2 },
        3: { number: 1003, name: 'C', course_number: 3, start_timing: 0.16, place_number: 3 }
      },
      technique_number: 1
    }
  });

  assert.equal(parsed.finished, true);
  assert.equal(parsed.result, '1-2-3');
  assert.deepEqual(parsed.payouts.trio, { combination: '1=2=3', amount: 450 });
  assert.deepEqual(parsed.payouts.exacta, { combination: '1-2', amount: 320 });
  assert.equal(parsed.racers[0].place, 1);
});
