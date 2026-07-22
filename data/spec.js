/* ============================================================
   sleepbook — the sleep-diary field-and-formula spec.
   Authored as DATA and imported by BOTH the app (browser global)
   and the Node self-tests. The engine reads every constant from
   here — no number is duplicated in app.js.

   28 hand-verified items:
     10 field definitions
      6 derived measures (formulas)
     12 worked-example fixture nights (8 valid + 4 invalid)

   Every field is cross-checked as a STANDARD sleep-diary item against
   two published CBT-I / consensus-sleep-diary descriptions (see
   sources/CITATIONS.md). Wording here is paraphrased in our own words:
   this is a GENERIC implementation of the standard fields, NOT a
   reproduction of the copyrighted Consensus Sleep Diary instrument.
   ============================================================ */

/* ---- plausibility caps (adversarial-review amendment) ----
   The across-midnight engine auto-adds 1440 min when a later event
   reads an earlier clock time. To keep that from silently "resolving"
   nonsensical sequences into huge durations, we cap the derived
   durations at clinical plausibility bounds. A duration over its cap
   is rejected with the named error 'duration exceeds plausible bound'. */
const CAPS = {
  preSleepMaxMin: 240,   // getting-into-bed -> lights-out ("settling in")
  tibMaxMin: 1440,       // one main sleep period fits inside a single day
  emaMaxMin: 240         // final-wake -> out-of-bed ("lying in")
};

/* ---- 1. Ten standard field definitions ----
   input types: date | time (HH:MM) | integer | scale (1-5) | text */
const FIELDS = [
  {
    id: 'morningDate', label: 'This morning (diary date)', type: 'date',
    unit: 'date', min: null, max: null, required: true,
    help: 'The calendar date of the morning you are filling this in — one entry per morning.'
  },
  {
    id: 'inBedTime', label: 'Time you got into bed', type: 'time',
    unit: 'HH:MM', min: null, max: null, required: true,
    help: 'Clock time you physically got into bed last night, even if you were reading or on your phone.'
  },
  {
    id: 'tryToSleepTime', label: 'Time you tried to fall asleep', type: 'time',
    unit: 'HH:MM', min: null, max: null, required: true,
    help: 'Clock time you turned the lights out and actually tried to sleep. May be the same as getting into bed.'
  },
  {
    id: 'solMinutes', label: 'Minutes to fall asleep (SOL)', type: 'integer',
    unit: 'min', min: 0, max: 600, required: true,
    help: 'Your best estimate of how many minutes it took to fall asleep after lights-out. 0 to 600.'
  },
  {
    id: 'awakeningsCount', label: 'Number of awakenings', type: 'integer',
    unit: 'count', min: 0, max: 50, required: true,
    help: 'How many separate times you woke up during the night after first falling asleep. 0 to 50.'
  },
  {
    id: 'wasoMinutes', label: 'Total minutes awake in the night (WASO)', type: 'integer',
    unit: 'min', min: 0, max: 600, required: true,
    help: 'Total minutes you were awake in the middle of the night, added together, not counting the final wake. 0 to 600.'
  },
  {
    id: 'finalWakeTime', label: 'Time of final awakening', type: 'time',
    unit: 'HH:MM', min: null, max: null, required: true,
    help: 'Clock time you woke for the last time and did not fall back asleep.'
  },
  {
    id: 'outOfBedTime', label: 'Time you got out of bed', type: 'time',
    unit: 'HH:MM', min: null, max: null, required: true,
    help: 'Clock time you actually got out of bed to start your day.'
  },
  {
    id: 'qualityRating', label: 'Sleep quality', type: 'scale',
    unit: '1-5', min: 1, max: 5, required: true,
    help: 'Overall, how was the quality of your sleep? 1 = very poor, 2 = poor, 3 = fair, 4 = good, 5 = very good.'
  },
  {
    id: 'note', label: 'Note (naps, caffeine, meds)', type: 'text',
    unit: 'text', min: 0, max: 500, required: false,
    help: 'Optional. Naps, caffeine, alcohol, medication, or anything unusual about the day. Up to 500 characters.'
  }
];

/* labels for the 1-5 quality scale (paraphrased generic anchors) */
const QUALITY_LABELS = {
  1: 'very poor', 2: 'poor', 3: 'fair', 4: 'good', 5: 'very good'
};

/* ---- 2. Six derived measures (formulas) ----
   duration(a -> b) is across-midnight clock arithmetic:
   minutesBetween(a, b) adds 1440 when b's clock time is earlier than a's.
   All formulas are minute-integer; sePct rounds to 1 dp. */
const MEASURES = [
  {
    id: 'preSleepMin', label: 'Pre-sleep wait',
    formula: 'duration(inBedTime -> tryToSleepTime)',
    note: 'Time settling in bed before trying to sleep. Capped at 240 min.'
  },
  {
    id: 'tibMin', label: 'Time in bed (TIB)',
    formula: 'duration(inBedTime -> outOfBedTime)',
    note: 'Total time in bed, lights-on to out-of-bed. Capped at 1440 min.'
  },
  {
    id: 'emaMin', label: 'Early-rise minutes (EMA)',
    formula: 'duration(finalWakeTime -> outOfBedTime)',
    note: 'Time lying in bed after the final awakening. Capped at 240 min.'
  },
  {
    id: 'tstMin', label: 'Total sleep time (TST)',
    formula: 'tibMin - preSleepMin - solMinutes - wasoMinutes - emaMin',
    note: 'Time actually asleep. Must be >= 0 or the night is rejected.'
  },
  {
    id: 'sePct', label: 'Sleep efficiency (SE)',
    formula: 'tstMin / tibMin * 100 (rounded to 1 dp)',
    note: 'Percent of time in bed spent asleep. The published standard SE = TST / TIB x 100.'
  },
  {
    id: 'aggregates', label: '7-day & 14-day averages',
    formula: 'mean of SE / TST / SOL / WASO over LOGGED nights only',
    note: 'Unlogged nights are excluded from the denominator.'
  }
];

/* ---- 3. Twelve worked-example fixture nights ----
   Every expected number was computed by hand on paper before coding.
   valid: 8   invalid (named error): 4
   error codes: SLEEP_PERIOD_OVERFLOW | FINAL_WAKE_AFTER_OUT_OF_BED
                | BED_EQUALS_OUT_OF_BED | DURATION_EXCEEDS_BOUND */
const FIXTURES = [
  /* -- valid -- */
  {
    id: 'plain', valid: true, label: 'Plain same-evening night',
    input: { morningDate: '2026-01-05', inBedTime: '23:00', tryToSleepTime: '23:15',
             solMinutes: 25, awakeningsCount: 2, wasoMinutes: 35,
             finalWakeTime: '06:10', outOfBedTime: '06:40', qualityRating: 3, note: '' },
    expect: { preSleepMin: 15, tibMin: 460, emaMin: 30, tstMin: 355, sePct: 77.2 }
  },
  {
    id: 'across-midnight-inbed', valid: true, label: 'Got into bed after midnight',
    input: { morningDate: '2026-01-06', inBedTime: '00:30', tryToSleepTime: '00:45',
             solMinutes: 20, awakeningsCount: 1, wasoMinutes: 10,
             finalWakeTime: '07:15', outOfBedTime: '07:30', qualityRating: 4, note: '' },
    /* preSleep 15; TIB 00:30->07:30 = 420; EMA 15; TST 420-15-20-10-15 = 360; SE 360/420 = 85.7 */
    expect: { preSleepMin: 15, tibMin: 420, emaMin: 15, tstMin: 360, sePct: 85.7 }
  },
  {
    id: 'lightsout-at-midnight', valid: true, label: 'Lights out exactly at 00:00',
    input: { morningDate: '2026-01-07', inBedTime: '23:40', tryToSleepTime: '00:00',
             solMinutes: 20, awakeningsCount: 0, wasoMinutes: 0,
             finalWakeTime: '07:00', outOfBedTime: '07:20', qualityRating: 4, note: '' },
    /* preSleep 23:40->00:00 = 20; TIB 23:40->07:20 = 460; EMA 20; TST 460-20-20-0-20 = 400; SE 400/460 = 87.0 */
    expect: { preSleepMin: 20, tibMin: 460, emaMin: 20, tstMin: 400, sePct: 87.0 }
  },
  {
    id: 'finalwake-at-midnight', valid: true, label: 'Final wake exactly at 00:00',
    input: { morningDate: '2026-01-08', inBedTime: '21:30', tryToSleepTime: '21:45',
             solMinutes: 15, awakeningsCount: 1, wasoMinutes: 20,
             finalWakeTime: '00:00', outOfBedTime: '00:20', qualityRating: 2, note: 'short night' },
    /* preSleep 15; TIB 21:30->00:20 = 170; EMA 00:00->00:20 = 20; TST 170-15-15-20-20 = 100; SE 100/170 = 58.8 */
    expect: { preSleepMin: 15, tibMin: 170, emaMin: 20, tstMin: 100, sePct: 58.8 }
  },
  {
    id: 'zero-sol-zero-waso', valid: true, label: 'Fell asleep instantly, no mid-night waking',
    input: { morningDate: '2026-01-09', inBedTime: '22:30', tryToSleepTime: '22:30',
             solMinutes: 0, awakeningsCount: 0, wasoMinutes: 0,
             finalWakeTime: '06:30', outOfBedTime: '06:45', qualityRating: 5, note: '' },
    /* preSleep 0; TIB 22:30->06:45 = 495; EMA 15; TST 495-0-0-0-15 = 480; SE 480/495 = 97.0 */
    expect: { preSleepMin: 0, tibMin: 495, emaMin: 15, tstMin: 480, sePct: 97.0 }
  },
  {
    id: 'perfect-efficiency', valid: true, label: '100% efficiency night',
    input: { morningDate: '2026-01-10', inBedTime: '23:00', tryToSleepTime: '23:00',
             solMinutes: 0, awakeningsCount: 0, wasoMinutes: 0,
             finalWakeTime: '06:00', outOfBedTime: '06:00', qualityRating: 5, note: '' },
    /* preSleep 0; TIB 420; EMA 0; TST 420; SE 100.0 */
    expect: { preSleepMin: 0, tibMin: 420, emaMin: 0, tstMin: 420, sePct: 100.0 }
  },
  {
    id: 'fragmented-low-se', valid: true, label: 'Very fragmented, low efficiency',
    input: { morningDate: '2026-01-11', inBedTime: '22:00', tryToSleepTime: '22:30',
             solMinutes: 60, awakeningsCount: 6, wasoMinutes: 150,
             finalWakeTime: '06:30', outOfBedTime: '07:00', qualityRating: 1, note: 'awful night' },
    /* preSleep 30; TIB 22:00->07:00 = 540; EMA 30; TST 540-30-60-150-30 = 270; SE 270/540 = 50.0 */
    expect: { preSleepMin: 30, tibMin: 540, emaMin: 30, tstMin: 270, sePct: 50.0 }
  },
  {
    id: 'one-third-ratio', valid: true, label: 'SE that lands on a repeating decimal (33.3)',
    input: { morningDate: '2026-01-12', inBedTime: '23:00', tryToSleepTime: '23:00',
             solMinutes: 130, awakeningsCount: 4, wasoMinutes: 130,
             finalWakeTime: '05:40', outOfBedTime: '06:00', qualityRating: 1, note: '' },
    /* preSleep 0; TIB 23:00->06:00 = 420; EMA 05:40->06:00 = 20; TST 420-0-130-130-20 = 140; SE 140/420 = 33.333 -> 33.3 */
    expect: { preSleepMin: 0, tibMin: 420, emaMin: 20, tstMin: 140, sePct: 33.3 }
  },

  /* -- invalid: each must return a NAMED error, never a negative number -- */
  {
    id: 'sleep-period-overflow', valid: false, label: 'SOL + WASO overflow the sleep period',
    input: { morningDate: '2026-01-13', inBedTime: '23:00', tryToSleepTime: '23:10',
             solMinutes: 300, awakeningsCount: 5, wasoMinutes: 300,
             finalWakeTime: '06:00', outOfBedTime: '06:20', qualityRating: 1, note: '' },
    /* preSleep 10; TIB 23:00->06:20 = 440; EMA 20; TST 440-10-300-300-20 = -190 < 0 -> reject */
    error: 'SLEEP_PERIOD_OVERFLOW'
  },
  {
    id: 'final-wake-after-out-of-bed', valid: false, label: 'Final wake is AFTER out-of-bed',
    input: { morningDate: '2026-01-14', inBedTime: '23:00', tryToSleepTime: '23:10',
             solMinutes: 20, awakeningsCount: 1, wasoMinutes: 15,
             finalWakeTime: '07:30', outOfBedTime: '07:00', qualityRating: 3, note: '' },
    /* out-of-bed 07:00 precedes final-wake 07:30 on the same morning -> impossible order */
    error: 'FINAL_WAKE_AFTER_OUT_OF_BED'
  },
  {
    id: 'bed-equals-out-of-bed', valid: false, label: 'Into-bed equals out-of-bed (zero TIB, ambiguous)',
    input: { morningDate: '2026-01-15', inBedTime: '23:00', tryToSleepTime: '23:00',
             solMinutes: 0, awakeningsCount: 0, wasoMinutes: 0,
             finalWakeTime: '23:00', outOfBedTime: '23:00', qualityRating: 3, note: '' },
    /* inBed === outOfBed -> TIB is 0 or 1440, ambiguous; SE undefined -> reject */
    error: 'BED_EQUALS_OUT_OF_BED'
  },
  {
    id: 'duration-exceeds-bound', valid: false, label: 'Pre-sleep wait exceeds the plausible bound',
    input: { morningDate: '2026-01-16', inBedTime: '18:00', tryToSleepTime: '23:30',
             solMinutes: 15, awakeningsCount: 0, wasoMinutes: 0,
             finalWakeTime: '06:30', outOfBedTime: '06:45', qualityRating: 3, note: '' },
    /* preSleep 18:00->23:30 = 330 min > 240 cap -> reject as implausible */
    error: 'DURATION_EXCEEDS_BOUND'
  }
];

if (typeof module !== 'undefined') {
  module.exports = { CAPS, FIELDS, QUALITY_LABELS, MEASURES, FIXTURES };
} else {
  // browser global consumed by engine.js and app.js
  (typeof self !== 'undefined' ? self : this).SLEEPBOOK_SPEC =
    { CAPS, FIELDS, QUALITY_LABELS, MEASURES, FIXTURES };
}
