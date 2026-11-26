// ---- CSV import (Blackbox Explorer / blackbox_decode) + field normalisation ----
const CSVL = (() => {
  function splitRow(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur.trim()); cur = ''; } else cur += c; }
    out.push(cur.trim()); return out;
  }
  function parse(text) {
    const lines = text.split(/\r?\n/); const hdr = {}; let h = -1;
    for (let i = 0; i < Math.min(lines.length, 2000); i++) {
      const r = splitRow(lines[i]); if (!r[0]) continue;
      if (/^loopIteration$/i.test(r[0]) || r.some(c => /^time/i.test(c) && r.length > 5)) { h = i; break; }
      if (r.length >= 2) hdr[r[0]] = r.slice(1).join(',');
    }
    if (h < 0) throw new Error('CSV 裡找不到欄位標題列（需要 loopIteration / time 欄位）');
    const raw = splitRow(lines[h]), names = raw.map(c => c.replace(/\s*\(.*?\)\s*$/, '').trim());
    const unit = raw.map(c => (c.match(/\((.*?)\)\s*$/) || [])[1] || '');
    const cols = names.map(() => []); let n = 0;
    for (let i = h + 1; i < lines.length; i++) {
      if (!lines[i]) continue; const r = lines[i].split(','); if (r.length < names.length - 1) continue;
      for (let k = 0; k < names.length; k++) cols[k].push(parseFloat(r[k]));
      n++;
    }
    const F = {}; let time = null;
    names.forEach((nm, k) => {
      let a = cols[k], u = unit[k].toLowerCase(), sc = 1;
      if (nm === 'vbatLatest' && u === 'v') sc = 100; if (nm === 'amperageLatest' && u === 'a') sc = 100;
      if (nm === 'time') { time = Float64Array.from(a, v => u === 'ms' ? v * 1000 : u === 's' ? v * 1e6 : v); }
      F[nm] = Int32Array.from(a, v => Math.round((isNaN(v) ? 0 : v) * sc));
    });
    if (!time) throw new Error('CSV 沒有 time 欄位');
    const t0 = time[0], t = Float64Array.from(time, v => (v - t0) / 1e6);
    return { hdr, names, F, t, rows: n, events: [], slow: [], slowNames: [], gps: [], corrupt: 0, csv: true };
  }
  // make sure the fields the analysis needs exist
  function prep(L) {
    const F = L.F, n = L.rows, z = () => new Int32Array(n);
    L.missing = [];
    if (!F['rcCommand[3]']) {
      const ms = [0, 1, 2, 3, 4, 5, 6, 7].map(k => F[`motor[${k}]`]).filter(Boolean);
      const mo = (L.hdr.motorOutput || '0,2047').split(',').map(Number);
      F['rcCommand[3]'] = Int32Array.from({ length: n }, (_, i) => ms.length ? 1000 + Math.round((ms.reduce((s, a) => s + a[i], 0) / ms.length - mo[0]) / (mo[1] - mo[0]) * 1000) : 1000);
      L.missing.push('油門（改用馬達平均估算）');
    }
    for (let ax = 0; ax < 3; ax++) {
      if (!F[`gyroADC[${ax}]`]) { F[`gyroADC[${ax}]`] = z(); L.missing.push(`gyroADC[${ax}]`); }
      if (!F[`setpoint[${ax}]`]) { F[`setpoint[${ax}]`] = F[`rcCommand[${ax}]`] ? Int32Array.from(F[`rcCommand[${ax}]`], v => v * 2) : z(); L.missing.push(`setpoint[${ax}]`); }
      for (const k of ['axisP', 'axisI', 'axisD']) if (!F[`${k}[${ax}]`] && !(k === 'axisD' && ax === 2)) F[`${k}[${ax}]`] = z();
    }
    return L;
  }
  return { parse, prep };
})();
if (typeof module !== 'undefined') module.exports = CSVL;
