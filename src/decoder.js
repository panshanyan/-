// ---- Betaflight blackbox decoder ----
const BB = (() => {
  const sx = (v, b) => { const s = 32 - b; return (v << s) >> s; };
  function splitLogs(u8) {
    const mark = [72,32,80,114,111,100,117,99,116,58]; // "H Product:"
    const starts = [];
    outer: for (let i = 0; i < u8.length - mark.length; i++) {
      if (u8[i] !== 72) continue;
      for (let j = 1; j < mark.length; j++) if (u8[i + j] !== mark[j]) continue outer;
      if (i === 0 || u8[i - 1] === 10 || true) starts.push(i);
    }
    return starts.map((s, k) => u8.subarray(s, k + 1 < starts.length ? starts[k + 1] : u8.length));
  }
  function decode(u8) {
    const hdr = {}; let p = 0; const n8 = u8.length;
    while (p < n8 - 1 && u8[p] === 72 && u8[p + 1] === 32) {
      let e = p; while (e < n8 && u8[e] !== 10) e++;
      let line = ''; for (let i = p + 2; i < e; i++) line += String.fromCharCode(u8[i]);
      const c = line.indexOf(':'); if (c > 0) hdr[line.slice(0, c)] = line.slice(c + 1);
      p = e + 1;
    }
    const il = s => (s || '').split(',').filter(x => x !== '').map(Number);
    const def = (t, base) => {
      if (!hdr['Field ' + t + ' name'] && !base) return null;
      const names = base ? base.names : hdr['Field ' + t + ' name'].split(',');
      return { names, signed: hdr['Field ' + t + ' signed'] ? il(hdr['Field ' + t + ' signed']) : (base ? base.signed : names.map(() => 0)),
        pred: il(hdr['Field ' + t + ' predictor']), enc: il(hdr['Field ' + t + ' encoding']) };
    };
    const I = def('I'); if (!I) throw new Error('找不到欄位定義（不是 Betaflight 黑盒子檔？）');
    const P = def('P', I), S = def('S'), G = def('G'), H = def('H');
    const mo = il(hdr['motorOutput'] || hdr['minmotor'] || '0');
    const minmotor = mo[0] || Number(hdr['minmotor'] || 0);
    const minthr = Number(hdr['minthrottle'] || minmotor);
    const vbatref = Number(hdr['vbatref'] || 0);
    let pint = (hdr['P interval'] || '1').split('/').map(Number);
    const pstep = pint.length > 1 ? pint[1] / pint[0] : pint[0];
    const n = I.names.length, iM0 = I.names.indexOf('motor[0]');
    const iHome0 = G ? G.names.indexOf('GPS_coord[0]') : -1;
    let r = p;
    const byte = () => { if (r >= n8) throw 0; return u8[r++]; };
    const uvb = () => { let v = 0, m = 1; for (let i = 0; i < 5; i++) { const b = byte(); v += (b & 127) * m; if (b < 128) return v >>> 0; m *= 128; } throw 1; };
    const svb = () => { const u = uvb(); return (u >>> 1) ^ -(u & 1); };
    function t2s32(lead) {
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const t = lead & 3; lead >>= 2;
        if (t === 0) out[i] = sx(byte(), 8);
        else if (t === 1) { const a = byte(), b = byte(); out[i] = sx(a | b << 8, 16); }
        else if (t === 2) { const a = byte(), b = byte(), c = byte(); out[i] = sx(a | b << 8 | c << 16, 24); }
        else { const a = byte(), b = byte(), c = byte(), d = byte(); out[i] = a | b << 8 | c << 16 | d << 24; }
      }
      return out;
    }
    function rd(fd, out) {
      const N = fd.names.length; let i = 0;
      while (i < N) {
        const e = fd.enc[i];
        if (e === 0) out[i++] = svb();
        else if (e === 1) out[i++] = uvb();
        else if (e === 3) out[i++] = -sx(uvb(), 14);
        else if (e === 9) out[i++] = 0;
        else if (e === 7 || e === 10) {
          let c = 0; while (i + c < N && c < 3 && fd.enc[i + c] === e) c++;
          const lead = byte(), sel = lead >> 6; let v;
          if (sel === 0) v = [sx(lead >> 4, 2), sx(lead >> 2, 2), sx(lead, 2)];
          else if (e === 7 && sel === 1) { const b = byte(); v = [sx(lead, 4), sx(b >> 4, 4), sx(b, 4)]; }
          else if (e === 7 && sel === 2) { const a = byte(), b = byte(); v = [sx(lead, 6), sx(a, 6), sx(b, 6)]; }
          else if (e === 10 && sel === 1) { const b = byte(); v = [sx((lead & 0x3E) >> 1, 5), sx(((lead & 1) << 4) | (b >> 4), 5), sx(b, 4)]; }
          else if (e === 10 && sel === 2) { const a = byte(), b = byte(); v = [sx(((lead & 0x3F) << 2) | (a >> 6), 8), sx(((a & 0x3F) << 1) | (b >> 7), 7), sx(b, 7)]; }
          else v = t2s32(lead);
          for (let j = 0; j < c; j++) out[i + j] = v[j]; i += c;
        } else if (e === 8) {
          let c = 0; while (i + c < N && c < 4 && fd.enc[i + c] === 8) c++;
          let sel = byte(), nib = 0, buf = 0;
          for (let j = 0; j < 4; j++) {
            const t = sel & 3; let v = 0;
            if (t === 1) { if (!nib) { buf = byte(); v = sx(buf >> 4, 4); nib = 1; } else { v = sx(buf, 4); nib = 0; } }
            else if (t === 2) { if (!nib) v = sx(byte(), 8); else { const c1 = byte(); v = sx(((buf & 15) << 4) | (c1 >> 4), 8); buf = c1; } }
            else if (t === 3) { if (!nib) { const a = byte(), b = byte(); v = sx(a << 8 | b, 16); } else { const a = byte(), b = byte(); v = sx(((buf & 15) << 12) | (a << 4) | (b >> 4), 16); buf = b; } }
            if (j < c) out[i + j] = v; sel >>= 2;
          }
          i += c;
        } else if (e === 6) {
          let c = 0; while (i + c < N && c < 8 && fd.enc[i + c] === 6) c++;
          if (c === 1) out[i] = svb();
          else { let h = byte(); for (let j = 0; j < c; j++) { out[i + j] = (h & 1) ? svb() : 0; h >>= 1; } }
          i += c;
        } else throw 2;
      }
    }
    let cap = Math.max(1024, (n8 / 12) | 0);
    let cols = I.names.map(() => new Int32Array(cap)); let time = new Float64Array(cap);
    let rows = 0;
    const grow = () => { cap *= 2; cols = cols.map(a => { const b = new Int32Array(cap); b.set(a); return b; }); const t2 = new Float64Array(cap); t2.set(time); time = t2; };
    const events = [], slow = [], gps = []; let home = [0, 0];
    let prev = null, prev2 = null, lastTime = 0, corrupt = 0;
    const cur = new Array(n).fill(0), raw = new Array(n).fill(0);
    const sRaw = S ? new Array(S.names.length).fill(0) : null;
    const gRaw = G ? new Array(G.names.length).fill(0) : null;
    const hRaw = H ? new Array(H.names.length).fill(0) : null;
    const valid = new Set([73, 80, 69, 71, 72, 83]);
    const tIdx = I.names.indexOf('time');
    let ended = false;
    while (r < n8 && !ended) {
      const start = r;
      try {
        const ft = byte(); let main = 0;
        if (ft === 73) { // I
          rd(I, raw);
          for (let k = 0; k < n; k++) {
            const pr = I.pred[k]; let v = raw[k];
            if (pr === 9) v += vbatref; else if (pr === 11) v += minmotor; else if (pr === 4) v += minthr; else if (pr === 8) v += 1500;
            cur[k] = v;
          }
          for (let k = 0; k < n; k++) if (I.pred[k] === 5) cur[k] += cur[iM0];
          main = 1;
        } else if (ft === 80) { // P
          if (!prev) throw 3;
          rd(P, raw);
          for (let k = 0; k < n; k++) {
            const pr = P.pred[k]; let v = raw[k];
            if (pr === 6) v = prev[k] + pstep;
            else if (pr === 1) v += prev[k];
            else if (pr === 2) v += 2 * prev[k] - prev2[k];
            else if (pr === 3) { const s = prev[k] + prev2[k]; v += P.signed[k] ? Math.trunc(s / 2) : Math.floor(s / 2); }
            else if (pr === 4) v += minthr; else if (pr === 8) v += 1500; else if (pr === 9) v += vbatref; else if (pr === 11) v += minmotor;
            else if (pr === 5) v += cur[iM0];
            cur[k] = v;
          }
          main = 2;
        } else if (ft === 69) { // E
          const et = byte(); let ev;
          if (et === 0) ev = { type: 'SYNC_BEEP', time: uvb() };
          else if (et === 13) { const f = byte(); if (f & 128) { for (let q = 0; q < 4; q++) byte(); ev = { type: 'ADJ', f }; } else ev = { type: 'ADJ', f, v: svb() }; }
          else if (et === 14) ev = { type: 'RESUME', iter: uvb(), time: uvb() };
          else if (et === 15) ev = { type: 'DISARM', reason: uvb() };
          else if (et === 30) ev = { type: 'FLIGHT_MODE', flags: uvb(), last: uvb() };
          else if (et === 255) { ev = { type: 'LOG_END' }; ended = true; }
          else throw 4;
          ev.t = lastTime; events.push(ev);
        } else if (ft === 83 && S) { rd(S, sRaw); slow.push([lastTime, ...sRaw]); }
        else if (ft === 71 && G) {
          rd(G, gRaw); const v = gRaw.slice();
          for (let k = 0; k < v.length; k++) { if (G.pred[k] === 10) v[k] += lastTime; if (G.pred[k] === 7) v[k] += home[k - iHome0] || 0; }
          gps.push(v);
        } else if (ft === 72 && H) { rd(H, hRaw); home = hRaw.slice(0, 2); }
        else throw 5;
        if (!ended && r < n8 && !valid.has(u8[r])) throw 6;
        if (main) {
          if (main === 2 && rows && (cur[tIdx] < lastTime || cur[tIdx] - lastTime > 2e6)) throw 7;
          if (rows >= cap) grow();
          for (let k = 0; k < n; k++) cols[k][rows] = cur[k];
          time[rows] = cur[tIdx]; rows++; lastTime = cur[tIdx];
          if (main === 1) { prev = cur.slice(); prev2 = prev; } else { prev2 = prev; prev = cur.slice(); }
        }
      } catch (e) {
        if (e instanceof Error && !(e instanceof RangeError)) throw e;
        corrupt++; r = start + 1; prev = prev2 = null;
        while (r < n8 && u8[r] !== 73) r++;
      }
    }
    const F = {}; I.names.forEach((nm, k) => F[nm] = cols[k].subarray(0, rows));
    const t0 = time[0];
    const t = new Float64Array(rows); for (let i = 0; i < rows; i++) t[i] = (time[i] - t0) / 1e6;
    for (const e of events) e.ts = (e.t - t0) / 1e6;
    return { hdr, names: I.names, F, t, rows, events, slow: slow.map(s => [(s[0] - t0) / 1e6, ...s.slice(1)]), slowNames: S ? S.names : [], gps, corrupt };
  }
  return { decode, splitLogs };
})();
if (typeof module !== 'undefined') module.exports = BB;
