/* ============================================================
   sleepbook — the sleep-diary math engine.
   Pure functions. No DOM, no globals, no clock/Date/random inputs
   (so results are timezone-independent and deterministic).
   Imported by BOTH app.js (browser global) and the Node self-tests.

   All constants come from data/spec.js — nothing is duplicated here.
   ============================================================ */

(function (root, factory) {
  const spec = (typeof module !== 'undefined')
    ? require('./spec.js')
    : root.SLEEPBOOK_SPEC;
  const api = factory(spec);
  if (typeof module !== 'undefined') module.exports = api;
  else root.SLEEPBOOK_ENGINE = api;
})(typeof self !== 'undefined' ? self : this, function (spec) {
  'use strict';

  const CAPS = spec.CAPS;
  const MINUTES_PER_DAY = 1440;

  /* ---- clock parsing ---- */
  // 'HH:MM' -> minutes since 00:00 (0..1439), or null if malformed.
  function parseClock(hhmm) {
    if (typeof hhmm !== 'string') return null;
    const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  // Across-midnight duration in minutes from clock `a` to clock `b`.
  // If b's clock time is strictly earlier than a's, the event is the
  // next day, so we add a full 1440-minute day. Equal clocks -> 0.
  // Returns a non-negative integer, or null if either clock is bad.
  function minutesBetween(a, b) {
    const ma = parseClock(a), mb = parseClock(b);
    if (ma === null || mb === null) return null;
    let d = mb - ma;
    if (d < 0) d += MINUTES_PER_DAY;
    return d;
  }

  /* ---- validation of one raw entry ---- */
  // Returns { ok:true } or { ok:false, errors:[{field, code, message}] }.
  function validateEntry(e) {
    const errors = [];
    const push = (field, code, message) => errors.push({ field, code, message });

    // date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.morningDate || ''))) {
      push('morningDate', 'BAD_DATE', 'Enter the diary date as YYYY-MM-DD.');
    }
    // clocks
    ['inBedTime', 'tryToSleepTime', 'finalWakeTime', 'outOfBedTime'].forEach((f) => {
      if (parseClock(e[f]) === null) {
        push(f, 'BAD_TIME', 'Enter a valid 24-hour time as HH:MM.');
      }
    });
    // integers with ranges (read the ranges from the spec, never hard-code)
    spec.FIELDS.forEach((fd) => {
      if (fd.type === 'integer' || fd.type === 'scale') {
        const v = e[fd.id];
        if (!Number.isInteger(v) || v < fd.min || v > fd.max) {
          push(fd.id, 'OUT_OF_RANGE',
            fd.label + ' must be a whole number from ' + fd.min + ' to ' + fd.max + '.');
        }
      }
      if (fd.type === 'text' && e[fd.id] != null && String(e[fd.id]).length > fd.max) {
        push(fd.id, 'TOO_LONG', fd.label + ' must be ' + fd.max + ' characters or fewer.');
      }
    });
    return errors.length ? { ok: false, errors } : { ok: true };
  }

  /* ---- the core computation for one night ----
     Returns either:
       { ok:true, preSleepMin, tibMin, emaMin, tstMin, sePct, seText }
       { ok:false, code, message }   (a NAMED sequence/plausibility error)
     The UI never receives a negative TST or SE — those become named errors. */
  function computeNight(e) {
    const v = validateEntry(e);
    if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };

    const preSleepMin = minutesBetween(e.inBedTime, e.tryToSleepTime);
    const tibMin = minutesBetween(e.inBedTime, e.outOfBedTime);
    const emaMin = minutesBetween(e.finalWakeTime, e.outOfBedTime);

    // inBed === outOfBed is ambiguous (TIB reads as 0 or a full day). Reject.
    if (parseClock(e.inBedTime) === parseClock(e.outOfBedTime)) {
      return { ok: false, code: 'BED_EQUALS_OUT_OF_BED',
        message: 'The time you got into bed and out of bed are identical — the night length is ambiguous. Check both times.' };
    }

    // Order events along the night window (offset in minutes from into-bed).
    // A wrap of exactly 0 means "same instant as into-bed" (start of window);
    // any later clock reads as a positive offset up to just under a full day.
    const inBedM = parseClock(e.inBedTime);
    const outM = ((parseClock(e.outOfBedTime) - inBedM) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const finalM = ((parseClock(e.finalWakeTime) - inBedM) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

    // Final awakening must not come AFTER out-of-bed within this rise.
    // Checked BEFORE the ema plausibility cap, because a reversed pair
    // produces a huge (wrapped) ema that would otherwise mask the real cause.
    if (finalM > outM) {
      return { ok: false, code: 'FINAL_WAKE_AFTER_OUT_OF_BED',
        message: 'Your final awakening is later than the time you got out of bed. Check those two times.' };
    }

    // Plausibility caps (from spec). A duration over its cap means the
    // across-midnight engine has "wrapped" into an implausible reading.
    if (preSleepMin > CAPS.preSleepMaxMin) {
      return { ok: false, code: 'DURATION_EXCEEDS_BOUND',
        message: 'The gap between getting into bed and lights-out is over ' + CAPS.preSleepMaxMin + ' minutes — duration exceeds the plausible bound. Check those two times.' };
    }
    if (emaMin > CAPS.emaMaxMin) {
      return { ok: false, code: 'DURATION_EXCEEDS_BOUND',
        message: 'The gap between your final awakening and getting out of bed is over ' + CAPS.emaMaxMin + ' minutes — duration exceeds the plausible bound. Check those two times.' };
    }
    if (tibMin > CAPS.tibMaxMin) {
      return { ok: false, code: 'DURATION_EXCEEDS_BOUND',
        message: 'Total time in bed is over ' + CAPS.tibMaxMin + ' minutes (a full day) — duration exceeds the plausible bound. Check the into-bed and out-of-bed times.' };
    }

    const tstMin = tibMin - preSleepMin - e.solMinutes - e.wasoMinutes - emaMin;
    if (tstMin < 0) {
      return { ok: false, code: 'SLEEP_PERIOD_OVERFLOW',
        message: 'Time to fall asleep plus time awake add up to more than the night itself — total sleep time would be negative. Check SOL, WASO, and your times.' };
    }

    const sePct = round1(tstMin / tibMin * 100);
    return {
      ok: true,
      preSleepMin, tibMin, emaMin, tstMin, sePct,
      seText: sePct.toFixed(1)
    };
  }

  /* ---- half-up rounding to 1 decimal place ----
     Works on an already-bounded 0..100 ratio; scale by 10, round, /10.
     Using a tiny epsilon nudge guards the exact-.5 tenths from binary
     representation landing a hair below (e.g. 77.15 stored as 77.1499…). */
  function round1(x) {
    return Math.round((x + Number.EPSILON) * 10) / 10;
  }

  /* ---- aggregates over LOGGED nights only ----
     nights: array of raw entries. Only nights that computeNight()
     accepts (ok:true) contribute; invalid/blank nights are excluded
     from the denominator. windowN limits to the most recent N by date. */
  function aggregate(nights, windowN) {
    const rows = nights
      .map((n) => ({ raw: n, comp: computeNight(n) }))
      .filter((r) => r.comp.ok)
      .sort((a, b) => (a.raw.morningDate < b.raw.morningDate ? -1 : 1));
    const use = (typeof windowN === 'number') ? rows.slice(-windowN) : rows;
    const n = use.length;
    if (n === 0) return { n: 0, seMean: null, tstMean: null, solMean: null, wasoMean: null };
    let se = 0, tst = 0, sol = 0, waso = 0;
    use.forEach((r) => {
      se += r.comp.sePct;
      tst += r.comp.tstMin;
      sol += r.raw.solMinutes;
      waso += r.raw.wasoMinutes;
    });
    return {
      n: n,
      seMean: round1(se / n),
      tstMean: round1(tst / n),
      solMean: round1(sol / n),
      wasoMean: round1(waso / n)
    };
  }

  /* ---- HH:MM formatter for minute durations (grid display) ---- */
  function fmtDuration(mins) {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

  return {
    MINUTES_PER_DAY,
    CAPS,
    parseClock,
    minutesBetween,
    validateEntry,
    computeNight,
    aggregate,
    round1,
    fmtDuration
  };
});
