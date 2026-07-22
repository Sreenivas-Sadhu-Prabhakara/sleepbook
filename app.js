/* ============================================================
   sleepbook — app wiring (no inline handlers; CSP-safe).
   All math lives in data/engine.js; all field/formula facts live in
   data/spec.js. This file only reads inputs, calls the engine, and
   paints the DOM.
   ============================================================ */
(function () {
  'use strict';

  var SPEC = window.SLEEPBOOK_SPEC;
  var ENGINE = window.SLEEPBOOK_ENGINE;
  var CSV = window.SLEEPBOOK_CSV;

  var STORE_KEY = 'sleepbook.diary.v1';
  var NAME_KEY = 'sleepbook.name.v1';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ---------- storage ---------- */
  function loadDiary() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }
  function saveDiary(d) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  // diary is an object keyed by morningDate -> entry
  var diary = loadDiary();
  var editingDate = null; // when editing a past entry

  /* ---------- build the form from the spec ---------- */
  function buildForm() {
    SPEC.FIELDS.forEach(function (fd) {
      var slot = document.querySelector('.field[data-field="' + fd.id + '"]');
      if (!slot) return;
      var id = 'f_' + fd.id;
      var label = document.createElement('label');
      label.className = 'field__label';
      label.setAttribute('for', id);
      label.textContent = fd.label + (fd.required ? '' : ' (optional)');

      var control;
      if (fd.type === 'text') {
        control = document.createElement('textarea');
        control.maxLength = fd.max;
        control.rows = 2;
      } else if (fd.type === 'scale') {
        control = document.createElement('select');
        for (var v = fd.min; v <= fd.max; v++) {
          var opt = document.createElement('option');
          opt.value = String(v);
          opt.textContent = v + ' — ' + SPEC.QUALITY_LABELS[v];
          control.appendChild(opt);
        }
        control.value = '3';
      } else {
        control = document.createElement('input');
        if (fd.type === 'date') { control.type = 'date'; }
        else if (fd.type === 'time') { control.type = 'time'; control.step = 60; }
        else if (fd.type === 'integer') {
          control.type = 'number';
          control.min = String(fd.min); control.max = String(fd.max); control.step = '1';
          control.inputMode = 'numeric';
        }
      }
      control.id = id;
      control.name = fd.id;
      control.className = 'field__control';
      if (fd.required) control.required = true;
      control.setAttribute('aria-describedby', id + '_help');

      var help = document.createElement('p');
      help.className = 'field__help';
      help.id = id + '_help';
      help.textContent = fd.help;

      var err = document.createElement('p');
      err.className = 'field__err';
      err.id = id + '_err';
      err.hidden = true;

      slot.appendChild(label);
      slot.appendChild(control);
      slot.appendChild(help);
      slot.appendChild(err);

      // live recompute as the user types
      control.addEventListener('input', function () { liveCompute(); });
      control.addEventListener('change', function () { liveCompute(); });
    });

    // default date = today (local); it is only a default the user can change
    var d = new Date();
    var iso = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    $('#f_morningDate').value = iso;
  }

  /* ---------- read the form into a raw entry ---------- */
  function readForm() {
    var e = {};
    SPEC.FIELDS.forEach(function (fd) {
      var el = document.getElementById('f_' + fd.id);
      if (!el) return;
      var raw = el.value;
      if (fd.type === 'integer' || fd.type === 'scale') {
        e[fd.id] = raw === '' ? NaN : parseInt(raw, 10);
      } else {
        e[fd.id] = raw;
      }
    });
    return e;
  }

  function clearFieldErrors() {
    SPEC.FIELDS.forEach(function (fd) {
      var err = document.getElementById('f_' + fd.id + '_err');
      var ctl = document.getElementById('f_' + fd.id);
      if (err) { err.hidden = true; err.textContent = ''; }
      if (ctl) { ctl.removeAttribute('aria-invalid'); }
    });
  }

  function showFieldErrors(errors) {
    errors.forEach(function (er) {
      var err = document.getElementById('f_' + er.field + '_err');
      var ctl = document.getElementById('f_' + er.field);
      if (err) { err.hidden = false; err.textContent = er.message; }
      if (ctl) { ctl.setAttribute('aria-invalid', 'true'); }
    });
  }

  /* ---------- the "night strip" motif ---------- */
  // Renders time-in-bed as one proportional bar: asleep segments filled
  // jade, awake segments (pre-sleep wait, SOL, WASO, early rise) left as
  // ink gaps. Returns an SVG element. WASO is distributed as one middle
  // gap (we do not know its position, so we render it as a single block
  // after onset — an honest, labelled approximation, not a timeline).
  function nightStrip(entry, comp, opts) {
    opts = opts || {};
    var w = opts.width || 240, h = opts.height || 18;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('class', 'strip');
    svg.setAttribute('role', 'img');

    var tib = comp.tibMin;
    // segment lengths in minutes, in order along time-in-bed:
    var pre = comp.preSleepMin;
    var sol = entry.solMinutes;
    var waso = entry.wasoMinutes;
    var ema = comp.emaMin;
    var sleepBeforeWaso = comp.tstMin; // all sleep as one solid run (approx.)
    // order: [awake: pre+sol] [asleep: tst] [awake: waso] [awake: ema]
    // We group the two trailing awake blocks visually but keep tst solid.
    var segs = [
      { kind: 'awake', min: pre + sol },
      { kind: 'asleep', min: sleepBeforeWaso },
      { kind: 'awake', min: waso + ema }
    ];
    var x = 0;
    var round = 3;
    // background track
    var track = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    track.setAttribute('x', '0'); track.setAttribute('y', '0');
    track.setAttribute('width', String(w)); track.setAttribute('height', String(h));
    track.setAttribute('rx', String(round));
    track.setAttribute('class', 'strip__track');
    svg.appendChild(track);

    segs.forEach(function (s) {
      if (s.min <= 0) return;
      var segW = (s.min / tib) * w;
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x.toFixed(2));
      r.setAttribute('y', '0');
      r.setAttribute('width', segW.toFixed(2));
      r.setAttribute('height', String(h));
      r.setAttribute('class', s.kind === 'asleep' ? 'strip__sleep' : 'strip__wake');
      svg.appendChild(r);
      x += segW;
    });
    // rounded mask via outer rect stroke
    var frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.setAttribute('x', '0.5'); frame.setAttribute('y', '0.5');
    frame.setAttribute('width', String(w - 1)); frame.setAttribute('height', String(h - 1));
    frame.setAttribute('rx', String(round));
    frame.setAttribute('class', 'strip__frame');
    svg.appendChild(frame);

    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = 'Time in bed ' + ENGINE.fmtDuration(tib) +
      '; asleep ' + ENGINE.fmtDuration(comp.tstMin) +
      '; sleep efficiency ' + comp.seText + '%';
    svg.appendChild(title);
    svg.setAttribute('aria-label', title.textContent);
    return svg;
  }

  /* ---------- live per-night readout ---------- */
  // On live typing we DON'T splash red field errors (the form starts blank);
  // we only show a calm hint. Field-level errors appear on Save, or once the
  // entry has enough to compute but hits a real sequence/plausibility error.
  function liveCompute() {
    var e = readForm();
    var comp = ENGINE.computeNight(e);
    var out = $('#readout');
    out.innerHTML = '';
    clearFieldErrors();

    if (!comp.ok) {
      // Distinguish "not filled in yet" from a genuine impossible sequence.
      var isIncomplete = comp.errors && comp.errors.some(function (er) {
        return er.code === 'BAD_TIME' || er.code === 'BAD_DATE' || er.code === 'OUT_OF_RANGE';
      });
      var p = document.createElement('p');
      if (isIncomplete) {
        p.className = 'readout__hint';
        p.textContent = 'Fill in every required field with a valid value to see the computed measures.';
      } else {
        // a real named sequence/plausibility error on an otherwise-complete night
        p.className = 'readout__err';
        p.textContent = comp.message;
        if (comp.errors) showFieldErrors(comp.errors);
      }
      out.appendChild(p);
      return;
    }

    var rows = [
      ['Pre-sleep wait', ENGINE.fmtDuration(comp.preSleepMin), 'into-bed → lights-out'],
      ['Time in bed (TIB)', ENGINE.fmtDuration(comp.tibMin), 'into-bed → out-of-bed'],
      ['Early-rise (EMA)', ENGINE.fmtDuration(comp.emaMin), 'final wake → out-of-bed'],
      ['Total sleep time (TST)', ENGINE.fmtDuration(comp.tstMin), 'TIB − pre-sleep − SOL − WASO − EMA'],
      ['Sleep efficiency (SE)', comp.seText + '%', 'TST ÷ TIB × 100']
    ];
    var wrap = document.createElement('div');
    wrap.className = 'readout__grid';
    rows.forEach(function (r, i) {
      var cell = document.createElement('div');
      cell.className = 'metric' + (i === 4 ? ' metric--se' : '');
      var val = document.createElement('div'); val.className = 'metric__val'; val.textContent = r[1];
      var lab = document.createElement('div'); lab.className = 'metric__lab'; lab.textContent = r[0];
      var fx = document.createElement('div'); fx.className = 'metric__fx'; fx.textContent = r[2];
      cell.appendChild(val); cell.appendChild(lab); cell.appendChild(fx);
      wrap.appendChild(cell);
    });
    out.appendChild(wrap);

    var stripWrap = document.createElement('div');
    stripWrap.className = 'readout__strip';
    var cap = document.createElement('span');
    cap.className = 'readout__stripcap';
    cap.textContent = 'This night:';
    stripWrap.appendChild(cap);
    stripWrap.appendChild(nightStrip(e, comp, { width: 320, height: 20 }));
    out.appendChild(stripWrap);
  }

  /* ---------- save / edit ---------- */
  function onSubmit(ev) {
    ev.preventDefault();
    var e = readForm();
    var comp = ENGINE.computeNight(e);
    clearFieldErrors();
    if (!comp.ok) {
      if (comp.errors) showFieldErrors(comp.errors);
      setMsg('#formMsg', comp.message || 'Please fix the highlighted fields.', 'err');
      return;
    }
    var key = e.morningDate;
    var isOverwrite = Object.prototype.hasOwnProperty.call(diary, key) && editingDate !== key;
    if (isOverwrite) {
      if (!window.confirm('A night is already saved for ' + key + '. Overwrite it?')) return;
    }
    diary[key] = e;
    saveDiary(diary);
    setMsg('#formMsg', 'Saved the night of ' + key + '.', 'ok');
    exitEdit();
    renderAll();
  }

  function beginEdit(date) {
    var e = diary[date];
    if (!e) return;
    SPEC.FIELDS.forEach(function (fd) {
      var el = document.getElementById('f_' + fd.id);
      if (el && e[fd.id] != null) el.value = e[fd.id];
    });
    editingDate = date;
    $('#entryMode').textContent = 'Editing the night of ' + date + '. Saving updates that entry.';
    $('#cancelEditBtn').hidden = false;
    $('#saveBtn').textContent = 'Update this night';
    liveCompute();
    $('#entry').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function exitEdit() {
    editingDate = null;
    $('#entryMode').textContent = 'Fill this in each morning. One entry per date; you can edit a past entry later.';
    $('#cancelEditBtn').hidden = true;
    $('#saveBtn').textContent = 'Save this night';
  }

  /* ---------- sorted, computed nights ---------- */
  function computedNights() {
    return Object.keys(diary).sort().map(function (date) {
      return { date: date, raw: diary[date], comp: ENGINE.computeNight(diary[date]) };
    });
  }

  /* ---------- two-week grid ---------- */
  function renderGrid() {
    var wrap = $('#gridWrap');
    var nights = computedNights().filter(function (n) { return n.comp.ok; });
    var recent = nights.slice(-14);
    if (recent.length === 0) {
      wrap.innerHTML = '<p class="empty" id="gridEmpty">No nights logged yet. Save a night above and it will appear here.</p>';
      return;
    }
    var table = document.createElement('table');
    table.className = 'grid-table';
    var head = document.createElement('thead');
    head.innerHTML =
      '<tr>' +
      '<th scope="col">Morning</th>' +
      '<th scope="col">Night strip</th>' +
      '<th scope="col" class="num">SOL</th>' +
      '<th scope="col" class="num">WASO</th>' +
      '<th scope="col" class="num">TIB</th>' +
      '<th scope="col" class="num">TST</th>' +
      '<th scope="col" class="num">SE%</th>' +
      '<th scope="col" class="num">Qual</th>' +
      '<th scope="col" class="actioncol">Edit</th>' +
      '</tr>';
    table.appendChild(head);
    var body = document.createElement('tbody');
    recent.forEach(function (n) {
      var tr = document.createElement('tr');
      var c = n.comp;
      tr.appendChild(td(n.date, 'mono'));
      var stripTd = document.createElement('td');
      stripTd.className = 'stripcell';
      stripTd.appendChild(nightStrip(n.raw, c, { width: 180, height: 16 }));
      tr.appendChild(stripTd);
      tr.appendChild(td(String(n.raw.solMinutes), 'num'));
      tr.appendChild(td(String(n.raw.wasoMinutes), 'num'));
      tr.appendChild(td(ENGINE.fmtDuration(c.tibMin), 'num'));
      tr.appendChild(td(ENGINE.fmtDuration(c.tstMin), 'num'));
      tr.appendChild(td(c.seText, 'num strong'));
      tr.appendChild(td(String(n.raw.qualityRating), 'num'));
      var act = document.createElement('td');
      act.className = 'actioncol';
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = 'Edit';
      b.setAttribute('aria-label', 'Edit the night of ' + n.date);
      b.addEventListener('click', function () { beginEdit(n.date); });
      act.appendChild(b);
      tr.appendChild(act);
      body.appendChild(tr);
    });
    table.appendChild(body);

    // averages rows: 7-day and 14-day over the recent set
    var foot = document.createElement('tfoot');
    var raws = recent.map(function (n) { return n.raw; });
    [['7-day avg', 7], ['14-day avg', 14]].forEach(function (pair) {
      var agg = ENGINE.aggregate(raws, pair[1]);
      var tr = document.createElement('tr');
      tr.className = 'avgrow';
      tr.appendChild(th(pair[0] + ' (' + agg.n + ' nights)'));
      tr.appendChild(td('', ''));
      tr.appendChild(td(agg.solMean == null ? '—' : String(agg.solMean), 'num'));
      tr.appendChild(td(agg.wasoMean == null ? '—' : String(agg.wasoMean), 'num'));
      tr.appendChild(td('', ''));
      tr.appendChild(td(agg.tstMean == null ? '—' : ENGINE.fmtDuration(Math.round(agg.tstMean)), 'num'));
      tr.appendChild(td(agg.seMean == null ? '—' : agg.seMean.toFixed(1), 'num strong'));
      tr.appendChild(td('', ''));
      tr.appendChild(td('', 'actioncol'));
      foot.appendChild(tr);
    });
    table.appendChild(foot);

    wrap.innerHTML = '';
    wrap.appendChild(table);
  }
  function td(text, cls) { var c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text; return c; }
  function th(text) { var c = document.createElement('th'); c.setAttribute('scope', 'row'); c.textContent = text; return c; }

  /* ---------- trend chart (inline SVG) ---------- */
  function renderTrend() {
    var wrap = $('#trendWrap');
    var nights = computedNights().filter(function (n) { return n.comp.ok; });
    if (nights.length < 2) {
      wrap.innerHTML = '<p class="empty">Log at least two nights to see the trend.</p>';
      return;
    }
    var W = 720, H = 240, padL = 44, padR = 44, padT = 18, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var n = nights.length;
    var xAt = function (i) { return padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW); };
    // SE axis 0..100 (left); TST axis 0..max hours (right)
    var maxTstH = Math.max.apply(null, nights.map(function (d) { return d.comp.tstMin / 60; }));
    maxTstH = Math.max(maxTstH, 8);
    var seY = function (v) { return padT + innerH - (v / 100) * innerH; };
    var tstY = function (h) { return padT + innerH - (h / maxTstH) * innerH; };

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'trend');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      'Line chart of sleep efficiency percent and total sleep time hours over ' + n + ' logged nights.');

    // gridlines + left axis (SE)
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = seY(v);
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('class', 'trend__grid');
      svg.appendChild(line);
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', padL - 8); t.setAttribute('y', y + 4);
      t.setAttribute('class', 'trend__axl trend__axl--se');
      t.setAttribute('text-anchor', 'end'); t.textContent = v + '%';
      svg.appendChild(t);
    });
    // right axis (TST hours) ticks
    [0, maxTstH / 2, maxTstH].forEach(function (h) {
      var y = tstY(h);
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', W - padR + 8); t.setAttribute('y', y + 4);
      t.setAttribute('class', 'trend__axl trend__axl--tst');
      t.setAttribute('text-anchor', 'start'); t.textContent = h.toFixed(1) + 'h';
      svg.appendChild(t);
    });

    function polyline(points, cls) {
      var pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', points.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '));
      pl.setAttribute('class', cls);
      svg.appendChild(pl);
    }
    var sePts = nights.map(function (d, i) { return [xAt(i), seY(d.comp.sePct)]; });
    var tstPts = nights.map(function (d, i) { return [xAt(i), tstY(d.comp.tstMin / 60)]; });
    polyline(tstPts, 'trend__line trend__line--tst');
    polyline(sePts, 'trend__line trend__line--se');

    // dots
    nights.forEach(function (d, i) {
      [['se', sePts[i]], ['tst', tstPts[i]]].forEach(function (pair) {
        var dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', pair[1][0]); dot.setAttribute('cy', pair[1][1]);
        dot.setAttribute('r', '3.2');
        dot.setAttribute('class', 'trend__dot trend__dot--' + pair[0]);
        var ti = document.createElementNS(ns, 'title');
        ti.textContent = d.date + ' — SE ' + d.comp.seText + '%, TST ' + ENGINE.fmtDuration(d.comp.tstMin);
        dot.appendChild(ti);
        svg.appendChild(dot);
      });
    });

    // x labels: first, middle, last date
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) {
      if (i < 0 || i >= n) return;
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', xAt(i)); t.setAttribute('y', H - 10);
      t.setAttribute('class', 'trend__xl'); t.setAttribute('text-anchor', 'middle');
      t.textContent = nights[i].date.slice(5);
      svg.appendChild(t);
    });

    wrap.innerHTML = '';
    var legend = document.createElement('div');
    legend.className = 'trend__legend';
    legend.innerHTML =
      '<span class="tl tl--se"><span class="tl__swatch"></span>Sleep efficiency (%)</span>' +
      '<span class="tl tl--tst"><span class="tl__swatch"></span>Total sleep time (h)</span>';
    wrap.appendChild(legend);
    wrap.appendChild(svg);
  }

  /* ---------- exports ---------- */
  function csvRows() {
    return computedNights().filter(function (n) { return n.comp.ok; }).map(function (n) {
      var c = n.comp;
      return {
        morningDate: n.raw.morningDate, inBedTime: n.raw.inBedTime,
        tryToSleepTime: n.raw.tryToSleepTime, solMinutes: n.raw.solMinutes,
        awakeningsCount: n.raw.awakeningsCount, wasoMinutes: n.raw.wasoMinutes,
        finalWakeTime: n.raw.finalWakeTime, outOfBedTime: n.raw.outOfBedTime,
        qualityRating: n.raw.qualityRating, note: n.raw.note || '',
        preSleepMin: c.preSleepMin, tibMin: c.tibMin, emaMin: c.emaMin,
        tstMin: c.tstMin, sePct: c.seText
      };
    });
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportCSV() {
    var rows = csvRows();
    if (rows.length === 0) { setMsg('#handoffMsg', 'Nothing to export yet.', 'err'); return; }
    download('sleepbook-diary.csv', CSV.encode(rows), 'text/csv;charset=utf-8');
    setMsg('#handoffMsg', 'Exported ' + rows.length + ' nights as CSV.', 'ok');
  }
  function exportJSON() {
    var payload = { app: 'sleepbook', version: '0.1.0', exported: new Date().toISOString(), diary: diary };
    download('sleepbook-backup.json', JSON.stringify(payload, null, 2), 'application/json');
    setMsg('#handoffMsg', 'Downloaded a full JSON backup.', 'ok');
  }
  function restoreJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var incoming = (parsed && parsed.diary && typeof parsed.diary === 'object') ? parsed.diary : parsed;
        if (!incoming || typeof incoming !== 'object') throw new Error('shape');
        var added = 0;
        Object.keys(incoming).forEach(function (k) {
          var e = incoming[k];
          if (e && typeof e === 'object' && ENGINE.computeNight(e).ok) { diary[k] = e; added++; }
        });
        saveDiary(diary);
        renderAll();
        setMsg('#handoffMsg', 'Restored ' + added + ' valid nights from the backup.', 'ok');
      } catch (e) {
        setMsg('#handoffMsg', 'That file could not be read as a sleepbook backup.', 'err');
      }
    };
    reader.readAsText(file);
  }
  function clearAll() {
    if (!window.confirm('Delete ALL saved nights from this browser? This cannot be undone — export a backup first.')) return;
    diary = {};
    saveDiary(diary);
    exitEdit();
    renderAll();
    setMsg('#handoffMsg', 'All saved nights deleted.', 'ok');
  }

  /* ---------- print ---------- */
  function preparePrintHeader() {
    var name = $('#patientName').value.trim();
    var nights = computedNights().filter(function (n) { return n.comp.ok; }).slice(-14);
    var range = nights.length ? (nights[0].date + ' to ' + nights[nights.length - 1].date) : '—';
    document.documentElement.style.setProperty('--print-name', JSON.stringify(name || 'Sleep diary'));
    var h = $('#printHeader');
    if (!h) {
      h = document.createElement('div');
      h.id = 'printHeader';
      h.className = 'printonly';
      document.body.insertBefore(h, document.body.firstChild);
    }
    h.innerHTML =
      '<h1 class="print-h1">Two-week sleep diary</h1>' +
      '<p class="print-meta">' +
      '<span><strong>Name / initials:</strong> ' + escapeHTML(name || '________') + '</span>' +
      '<span><strong>Date range:</strong> ' + escapeHTML(range) + '</span>' +
      '<span><strong>Nights:</strong> ' + nights.length + '</span>' +
      '</p>' +
      '<p class="print-note">Sleep efficiency SE = total sleep time ÷ time in bed × 100. ' +
      'Self-report diary; informational only, not a diagnosis. Generic implementation of standard ' +
      'sleep-diary fields.</p>';
  }
  function doPrint() {
    var nights = computedNights().filter(function (n) { return n.comp.ok; });
    if (nights.length === 0) { setMsg('#handoffMsg', 'Log at least one night before printing.', 'err'); return; }
    preparePrintHeader();
    window.print();
  }

  /* ---------- helpers ---------- */
  function setMsg(sel, text, kind) {
    var el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.className = (sel === '#formMsg' ? 'formmsg' : 'handoff__note') +
      (kind === 'ok' ? ' is-ok' : kind === 'err' ? ' is-err' : '');
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- render everything ---------- */
  function renderAll() {
    renderGrid();
    renderTrend();
  }

  /* ---------- init ---------- */
  function init() {
    if (!SPEC || !ENGINE || !CSV) return;
    buildForm();

    // restore saved name
    try {
      var savedName = localStorage.getItem(NAME_KEY);
      if (savedName) $('#patientName').value = savedName;
    } catch (e) {}
    $('#patientName').addEventListener('input', function () {
      try { localStorage.setItem(NAME_KEY, $('#patientName').value); } catch (e) {}
    });

    $('#diaryForm').addEventListener('submit', onSubmit);
    $('#resetBtn').addEventListener('click', function () {
      $('#diaryForm').reset();
      clearFieldErrors();
      buildFormDefaults();
      liveCompute();
      setMsg('#formMsg', '', '');
    });
    $('#cancelEditBtn').addEventListener('click', function () {
      exitEdit();
      $('#diaryForm').reset();
      buildFormDefaults();
      liveCompute();
    });
    $('#printBtn').addEventListener('click', doPrint);
    $('#csvBtn').addEventListener('click', exportCSV);
    $('#jsonBtn').addEventListener('click', exportJSON);
    $('#clearAllBtn').addEventListener('click', clearAll);
    $('#restoreInput').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) restoreJSON(f);
      ev.target.value = '';
    });

    renderAll();
    liveCompute();
  }

  // reset just re-defaults the date + quality without rebuilding the DOM
  function buildFormDefaults() {
    var d = new Date();
    var iso = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    $('#f_morningDate').value = iso;
    var q = $('#f_qualityRating'); if (q) q.value = '3';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
