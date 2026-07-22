# Sources & citations — sleepbook

sleepbook is a **generic implementation of the standard sleep-diary fields and the
published sleep-efficiency formula**. It does **not** reproduce the wording or layout of
the copyrighted Consensus Sleep Diary instrument. Every field label and help text in
`data/spec.js` is paraphrased in our own words.

Each of the 10 diary fields was cross-checked as a standard sleep-diary item against the
two published descriptions below, and the derived-measure formulas were matched to the
published `SE = TST / TIB × 100` standard.

## 1. Consensus Sleep Diary (Carney et al., 2012)

- **Citation:** Carney CE, Buysse DJ, Ancoli-Israel S, Edinger JD, Krystal AD, Lichstein KL,
  Morin CM. *The Consensus Sleep Diary: Standardizing Prospective Sleep Self-Monitoring.*
  Sleep. 2012;35(2):287–302.
- **Staged copy:** `carney-2012-consensus-sleep-diary.pdf` (University of Alabama
  Institutional Repository open-access copy).
- **Source URL (open access):** https://ir.ua.edu/bitstreams/ed37181d-3aca-4176-a0c2-71b8f6be8e29/download
- **Verified:** 2026-07-22.
- **What it confirms — the standard core items** (paraphrased in the app):
  - Time got into bed; time tried to go to sleep; how long to fall asleep (SOL, minutes);
    number of awakenings; total time awake during the night (WASO, minutes); time of
    final awakening; time got out of bed; sleep-quality rating on a 5-point scale.
  - Derived measures: **TIB = rise time − bedtime**, **TST = TIB − SOL − WASO** (and, in
    sleepbook, additionally minus the pre-sleep wait and early-rise minutes),
    **SE = (TST ÷ TIB) × 100**.

## 2. Sleep efficiency / CBT-I sleep-restriction description

- **Citation:** Sleep Foundation. *Sleep Restriction Therapy for Insomnia.*
- **Staged copy:** `sleepfoundation-sleep-restriction-therapy.html`.
- **Source URL:** https://www.sleepfoundation.org/insomnia/treatment/sleep-restriction-therapy
- **Verified:** 2026-07-22.
- **What it confirms:** Sleep efficiency is average total sleep time (TST) divided by average
  time in bed (TIB), multiplied by 100; the 85% figure is a commonly cited CBT-I target.
  sleepbook reports the number only — it never prescribes a sleep window or bedtime.

## Honest scope of verification

- **Verified against a real source:** the standard sleep-diary field set and the
  `SE = TST/TIB × 100` formula (both sources above).
- **Authored, not "verified"** (they are arithmetic, computed by hand before coding, then
  asserted in `test/engine.test.js`): the 12 worked-example fixture nights and the
  plausibility caps (preSleepMin ≤ 240, tibMin ≤ 1440, emaMin ≤ 240). These are our own
  design choices to keep the across-midnight engine from silently accepting implausible
  sequences; they are not a clinical threshold.
- sleepbook makes **no** clinical interpretation of any number beyond reporting it and
  showing its formula.
