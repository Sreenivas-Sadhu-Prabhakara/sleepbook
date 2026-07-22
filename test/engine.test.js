'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('../data/spec.js');
const engine = require('../data/engine.js');
const csv = require('../data/csv.js');

/* -------------------------------------------------------------
   1. Clock arithmetic — the across-midnight engine
   ------------------------------------------------------------- */
test('minutesBetween wraps across midnight and handles same-evening', () => {
  assert.equal(engine.minutesBetween('23:15', '06:30'), 435); // wrap: +1440
  assert.equal(engine.minutesBetween('22:00', '22:45'), 45);  // same evening
  assert.equal(engine.minutesBetween('23:00', '23:00'), 0);   // equal clocks -> 0
  assert.equal(engine.minutesBetween('00:00', '00:00'), 0);
});

test('parseClock rejects malformed times', () => {
  assert.equal(engine.parseClock('24:00'), null);
  assert.equal(engine.parseClock('12:60'), null);
  assert.equal(engine.parseClock('7:5'), null);
  assert.equal(engine.parseClock(''), null);
  assert.equal(engine.parseClock('07:05'), 425);
});

/* -------------------------------------------------------------
   2. The primary worked fixture, asserted field-by-field
   ------------------------------------------------------------- */
test('primary worked fixture: inBed 23:00 lightsOut 23:15 SOL25 WASO35 wake06:10 out06:40', () => {
  const r = engine.computeNight({
    morningDate: '2026-01-05', inBedTime: '23:00', tryToSleepTime: '23:15',
    solMinutes: 25, awakeningsCount: 2, wasoMinutes: 35,
    finalWakeTime: '06:10', outOfBedTime: '06:40', qualityRating: 3, note: ''
  });
  assert.equal(r.ok, true);
  assert.equal(r.preSleepMin, 15);
  assert.equal(r.tibMin, 460);
  assert.equal(r.emaMin, 30);
  assert.equal(r.tstMin, 355);
  assert.equal(r.sePct, 77.2);
  assert.equal(r.seText, '77.2');
});

/* -------------------------------------------------------------
   3. Exact-midnight boundaries
   ------------------------------------------------------------- */
test('exact-midnight boundaries for pre-sleep and early-rise', () => {
  // inBed 23:40 with lightsOut 00:00 -> preSleep 20
  assert.equal(engine.minutesBetween('23:40', '00:00'), 20);
  // finalWake 23:55 with outBed 00:20 -> EMA 25
  assert.equal(engine.minutesBetween('23:55', '00:20'), 25);
});

/* -------------------------------------------------------------
   4. Every spec FIXTURE asserted exactly (8 valid + 4 named errors)
   ------------------------------------------------------------- */
test('all valid spec fixtures compute to their hand-derived numbers', () => {
  spec.FIXTURES.filter((f) => f.valid).forEach((f) => {
    const r = engine.computeNight(f.input);
    assert.equal(r.ok, true, f.id + ' should be valid');
    assert.equal(r.preSleepMin, f.expect.preSleepMin, f.id + ' preSleepMin');
    assert.equal(r.tibMin, f.expect.tibMin, f.id + ' tibMin');
    assert.equal(r.emaMin, f.expect.emaMin, f.id + ' emaMin');
    assert.equal(r.tstMin, f.expect.tstMin, f.id + ' tstMin');
    assert.equal(r.sePct, f.expect.sePct, f.id + ' sePct');
    // no negative numbers ever leak
    assert.ok(r.tstMin >= 0 && r.sePct >= 0 && r.sePct <= 100, f.id + ' bounds');
  });
});

test('all invalid spec fixtures return their named error code, never a number', () => {
  spec.FIXTURES.filter((f) => !f.valid).forEach((f) => {
    const r = engine.computeNight(f.input);
    assert.equal(r.ok, false, f.id + ' should be rejected');
    assert.equal(r.code, f.error, f.id + ' error code');
    assert.equal(r.tstMin, undefined, f.id + ' must not expose a TST');
    assert.equal(r.sePct, undefined, f.id + ' must not expose an SE');
    assert.ok(typeof r.message === 'string' && r.message.length > 0, f.id + ' has a human message');
  });
});

/* -------------------------------------------------------------
   5. Plausibility caps (adversarial-review amendment)
   ------------------------------------------------------------- */
test('plausibility caps are enforced from the spec', () => {
  assert.equal(spec.CAPS.preSleepMaxMin, 240);
  assert.equal(spec.CAPS.tibMaxMin, 1440);
  assert.equal(engine.CAPS.preSleepMaxMin, spec.CAPS.preSleepMaxMin); // engine reads from spec

  // preSleep just over 240 -> DURATION_EXCEEDS_BOUND
  const over = engine.computeNight({
    morningDate: '2026-02-01', inBedTime: '18:00', tryToSleepTime: '22:01', // 241 min
    solMinutes: 10, awakeningsCount: 0, wasoMinutes: 0,
    finalWakeTime: '06:00', outOfBedTime: '06:15', qualityRating: 3, note: ''
  });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'DURATION_EXCEEDS_BOUND');

  // preSleep at exactly 240 is allowed
  const at = engine.computeNight({
    morningDate: '2026-02-02', inBedTime: '18:00', tryToSleepTime: '22:00', // 240 min
    solMinutes: 10, awakeningsCount: 0, wasoMinutes: 0,
    finalWakeTime: '06:00', outOfBedTime: '06:10', qualityRating: 3, note: ''
  });
  assert.equal(at.ok, true);
  assert.equal(at.preSleepMin, 240);
});

/* -------------------------------------------------------------
   6. SE rounding at boundaries
   ------------------------------------------------------------- */
test('SE rounds to 1 decimal at boundaries', () => {
  // 355/460 -> 77.17.. -> 77.2
  assert.equal(engine.round1(355 / 460 * 100), 77.2);
  // 1/3 ratio -> 33.333 -> 33.3
  assert.equal(engine.round1(140 / 420 * 100), 33.3);
  // 100%
  assert.equal(engine.round1(420 / 420 * 100), 100.0);
});

/* -------------------------------------------------------------
   7. Aggregates over logged nights only, 7-day + 14-day
   ------------------------------------------------------------- */
test('7-day and 14-day averages exclude unlogged nights and match hand means', () => {
  const valid = spec.FIXTURES.filter((f) => f.valid).map((f) => f.input);
  // hand means of the 8 valid fixtures' SE:
  // 77.2 + 85.7 + 87.0 + 58.8 + 97.0 + 100.0 + 50.0 + 33.3 = 589.0 / 8 = 73.625 -> 73.6
  const all = engine.aggregate(valid);
  assert.equal(all.n, 8);
  assert.equal(all.seMean, 73.6);

  // TST means: 355,360,400,100,480,420,270,140 => 2525 / 8 = 315.625 -> 315.6
  assert.equal(all.tstMean, 315.6);

  // 7-day window keeps only the most recent 7 by date; the earliest
  // fixture (2026-01-05, the 'plain' night, SE 77.2) drops out.
  const w7 = engine.aggregate(valid, 7);
  assert.equal(w7.n, 7);
  // most recent 7 SE: drop 77.2 -> sum 511.8 / 7 = 73.114.. -> 73.1
  assert.equal(w7.seMean, 73.1);

  // an invalid night mixed in must NOT change the denominator
  const withBad = valid.concat([spec.FIXTURES.find((f) => !f.valid).input]);
  const mixed = engine.aggregate(withBad);
  assert.equal(mixed.n, 8, 'invalid night excluded from the average');
  assert.equal(mixed.seMean, 73.6);
});

/* -------------------------------------------------------------
   8. Property test: 5,000 seeded random valid nights
   ------------------------------------------------------------- */
// deterministic PRNG (mulberry32) so the run is byte-reproducible
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pad2(n) { return String(n).padStart(2, '0'); }
function clockFromMin(m) { m = ((m % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

test('property: 5000 seeded valid nights satisfy the identity and bounds', () => {
  const rnd = mulberry32(20260722);
  let checked = 0;
  for (let i = 0; i < 5000; i++) {
    // build a night guaranteed to be valid by construction:
    const inBedAbs = 20 * 60 + Math.floor(rnd() * 6 * 60); // 20:00..02:00 range start
    const preSleep = Math.floor(rnd() * 61);               // 0..60  (<=240 cap)
    const tib = 180 + Math.floor(rnd() * 600);             // 180..779 (<=1440)
    const ema = Math.floor(rnd() * 61);                    // 0..60  (<=240 cap)
    // sleepable minutes left after preSleep and ema:
    const sleepable = tib - preSleep - ema;
    if (sleepable < 0) continue;
    const sol = Math.floor(rnd() * (sleepable + 1));
    const waso = Math.floor(rnd() * (sleepable - sol + 1));
    // clocks
    const inBedTime = clockFromMin(inBedAbs);
    const tryToSleepTime = clockFromMin(inBedAbs + preSleep);
    const outOfBedTime = clockFromMin(inBedAbs + tib);
    const finalWakeTime = clockFromMin(inBedAbs + tib - ema);
    const night = {
      morningDate: '2026-03-01', inBedTime, tryToSleepTime,
      solMinutes: sol, awakeningsCount: 1, wasoMinutes: waso,
      finalWakeTime, outOfBedTime, qualityRating: 3, note: ''
    };
    const r = engine.computeNight(night);
    if (!r.ok) continue; // an inBed===outOfBed collision is legitimately skipped
    assert.ok(r.sePct >= 0 && r.sePct <= 100, 'SE in [0,100]');
    assert.ok(r.tstMin >= 0, 'TST >= 0');
    // the exact partition identity in integer minutes
    assert.equal(
      r.preSleepMin + night.solMinutes + night.wasoMinutes + r.emaMin + r.tstMin,
      r.tibMin,
      'preSleep + SOL + WASO + EMA + TST === TIB'
    );
    checked++;
  }
  assert.ok(checked > 4000, 'the vast majority of constructed nights were valid (' + checked + ')');
});

/* -------------------------------------------------------------
   9. CSV round-trip with RFC-4180 quoting
   ------------------------------------------------------------- */
test('CSV round-trip preserves raw fields incl. a nasty note', () => {
  const nasty = 'coffee at 4pm, then "wine", and a w鿁rap\nnew line note';
  const fixture = spec.FIXTURES.filter((f) => f.valid).slice(0, 3).map((f) => {
    const c = engine.computeNight(f.input);
    return Object.assign({}, f.input, {
      preSleepMin: c.preSleepMin, tibMin: c.tibMin, emaMin: c.emaMin,
      tstMin: c.tstMin, sePct: c.seText
    });
  });
  fixture[0].note = nasty; // comma + double-quote + newline

  const text = csv.encode(fixture);
  // header row must match the documented column list exactly
  assert.equal(text.split('\r\n')[0], csv.COLUMNS.join(','));

  const back = csv.parseToObjects(text);
  assert.equal(back.length, fixture.length);
  // the nasty note survives intact
  assert.equal(back[0].note, nasty);
  // every raw field round-trips (compare as strings, since CSV is textual)
  csv.COLUMNS.forEach((col) => {
    assert.equal(back[0][col], String(fixture[0][col]), 'round-trip column ' + col);
  });
});

test('CSV encodeField quotes only when required (RFC-4180)', () => {
  assert.equal(csv.encodeField('plain'), 'plain');
  assert.equal(csv.encodeField('has,comma'), '"has,comma"');
  assert.equal(csv.encodeField('has"quote'), '"has""quote"');
  assert.equal(csv.encodeField('has\nnewline'), '"has\nnewline"');
});

/* -------------------------------------------------------------
   10. Timezone independence + fixed-1440 DST limitation
   ------------------------------------------------------------- */
test('clock arithmetic is timezone-independent (fixed 1440-min day)', () => {
  const night = spec.FIXTURES[0].input;

  // capture under an explicit TZ, then flip it and recompute in a child idea:
  // engine uses no Date/Intl, so results must be identical regardless of TZ.
  const saved = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  const a = engine.computeNight(night);
  process.env.TZ = 'America/New_York';
  const b = engine.computeNight(night);
  process.env.TZ = saved;

  assert.deepEqual(a, b, 'identical results under different TZ');
  // documents the fixed-day assumption: a wrap is always exactly 1440
  assert.equal(engine.MINUTES_PER_DAY, 1440);
});

/* -------------------------------------------------------------
   11. Corpus / spec invariants
   ------------------------------------------------------------- */
test('spec has exactly 28 hand-verified items (10 fields + 6 measures + 12 fixtures)', () => {
  assert.equal(spec.FIELDS.length, 10);
  assert.equal(spec.MEASURES.length, 6);
  assert.equal(spec.FIXTURES.length, 12);
  assert.equal(spec.FIELDS.length + spec.MEASURES.length + spec.FIXTURES.length, 28);
});

test('field ids are unique and help text stays within 140 chars', () => {
  const ids = new Set();
  spec.FIELDS.forEach((f) => {
    assert.ok(!ids.has(f.id), 'duplicate field id ' + f.id);
    ids.add(f.id);
    assert.ok(f.help.length <= 140, f.id + ' help <=140 chars (' + f.help.length + ')');
    assert.ok(['date', 'time', 'integer', 'scale', 'text'].includes(f.type), f.id + ' known type');
  });
  // the exact 10 standard ids the brief names
  assert.deepEqual([...ids], [
    'morningDate', 'inBedTime', 'tryToSleepTime', 'solMinutes', 'awakeningsCount',
    'wasoMinutes', 'finalWakeTime', 'outOfBedTime', 'qualityRating', 'note'
  ]);
});

test('spec range rules match the brief exactly', () => {
  const byId = Object.fromEntries(spec.FIELDS.map((f) => [f.id, f]));
  assert.deepEqual([byId.solMinutes.min, byId.solMinutes.max], [0, 600]);
  assert.deepEqual([byId.awakeningsCount.min, byId.awakeningsCount.max], [0, 50]);
  assert.deepEqual([byId.wasoMinutes.min, byId.wasoMinutes.max], [0, 600]);
  assert.deepEqual([byId.qualityRating.min, byId.qualityRating.max], [1, 5]);
  assert.equal(byId.note.max, 500);
});

test('fixture morningDate ids are unique (one entry per morning)', () => {
  const dates = spec.FIXTURES.map((f) => f.input.morningDate);
  assert.equal(new Set(dates).size, dates.length);
});
