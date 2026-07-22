/* ============================================================
   sleepbook — RFC-4180 CSV encode/parse for the diary export.
   Shared by app.js (browser global) and the Node self-tests so the
   round-trip is proven, not assumed.

   RFC-4180 rules honored:
     - fields separated by comma, records by CRLF
     - a field containing comma, double-quote, or a line break is quoted
     - a literal double-quote inside a quoted field is doubled ("")
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.SLEEPBOOK_CSV = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The documented raw + derived column order for the diary export.
  const COLUMNS = [
    'morningDate', 'inBedTime', 'tryToSleepTime', 'solMinutes',
    'awakeningsCount', 'wasoMinutes', 'finalWakeTime', 'outOfBedTime',
    'qualityRating', 'note',
    'preSleepMin', 'tibMin', 'emaMin', 'tstMin', 'sePct'
  ];

  function needsQuote(s) {
    return /[",\r\n]/.test(s);
  }

  function encodeField(v) {
    const s = (v == null) ? '' : String(v);
    if (needsQuote(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // rows: array of objects keyed by COLUMNS. Returns a CRLF-joined CSV string.
  function encode(rows, columns) {
    const cols = columns || COLUMNS;
    const out = [cols.map(encodeField).join(',')];
    rows.forEach((r) => {
      out.push(cols.map((c) => encodeField(r[c])).join(','));
    });
    return out.join('\r\n');
  }

  // Full RFC-4180 parser (handles quotes, escaped quotes, embedded CRLF).
  // Returns an array of records; each record is an array of string fields.
  function parse(text) {
    const records = [];
    let field = '';
    let record = [];
    let i = 0;
    const n = text.length;
    let inQuotes = false;
    let started = false; // have we begun any field/record content?

    while (i < n) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; started = true; i++; continue; }
      if (ch === ',') { record.push(field); field = ''; started = true; i++; continue; }
      if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        record.push(field); records.push(record);
        field = ''; record = []; started = false; i++; continue;
      }
      if (ch === '\n') {
        record.push(field); records.push(record);
        field = ''; record = []; started = false; i++; continue;
      }
      field += ch; started = true; i++;
    }
    // flush trailing field/record (file may not end in a newline)
    if (started || field.length || record.length) {
      record.push(field);
      records.push(record);
    }
    return records;
  }

  // Parse a full export back into row objects keyed by the header line.
  function parseToObjects(text) {
    const recs = parse(text);
    if (recs.length === 0) return [];
    const header = recs[0];
    return recs.slice(1).map((r) => {
      const o = {};
      header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ''; });
      return o;
    });
  }

  return { COLUMNS, encode, parse, parseToObjects, encodeField };
});
