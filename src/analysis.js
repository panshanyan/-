// ---- analysis ----
const AN = (() => {
  const DISARM = { 0: '解鎖被禁止', 1: '失控保護 (failsafe)', 2: '油門逾時', 3: '搖桿上鎖', 4: '開關上鎖', 5: '墜機保護', 6: '防暴衝 (runaway takeoff)', 7: 'GPS 救援', 8: '序列指令', 9: '降落上鎖', 255: '系統' };
  const AXN = ['Roll', 'Pitch', 'Yaw'];
  function median(a) { const b = Float64Array.from(a).sort(); return b.length ? b[b.length >> 1] : NaN; }
  function pct(a, q) { const b = Float64Array.from(a).sort(); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : NaN; }
  function biquad(x, fs, type, f0, Q) {
    const w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    const y = new Float64Array(x.length); let x1 = x[0] || 0, x2 = x1, y1 = type === 'lp' ? x1 : 0, y2 = y1;
    for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  const rev = a => a.slice().reverse();
  function filtfilt(x, fs, type, f0, Q) { return rev(biquad(rev(biquad(x, fs, type, f0, Q)), fs, type, f0, Q)); }
  function band(x, fs, lo, hi) { let y = filtfilt(Float64Array.from(x), fs, 'hp', lo, 0.707); y = filtfilt(y, fs, 'lp', hi, 0.707); return y; }
  function envelope(x, fs, win) { const n = x.length, w = Math.max(3, Math.round(win * fs)), e = new Float64Array(n); let s = 0; const sq = x.map(v => v * v);
    for (let i = 0; i < n; i++) { s += sq[i]; if (i >= w) s -= sq[i - w]; e[i] = Math.sqrt(Math.max(0, s) / Math.min(i + 1, w)) * Math.SQRT2; }
    const o = new Float64Array(n), h = w >> 1; for (let i = 0; i < n; i++) o[i] = e[Math.min(n - 1, i + h)]; return o; }
  function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
  function welch(x, fs, N = 1024) { const P = new Float64Array(N / 2); let cnt = 0; const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    for (let s = 0; s + N <= x.length; s += N / 2) { let m = 0; for (let i = 0; i < N; i++) m += x[s + i]; m /= N; const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (x[s + i] - m) * win[i]; fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; cnt++; }
    if (cnt) for (let k = 0; k < N / 2; k++) P[k] /= cnt; return { P, df: fs / N, cnt }; }

  function analyze(L) {
    const { F, t, rows, hdr } = L, has = k => !!F[k];
    const fs = rows > 1 ? (rows - 1) / (t[rows - 1] - t[0]) : 1;
    const thr = F['rcCommand[3]'];
    let fa = 0, la = rows - 1; while (fa < rows && thr[fa] <= 1050) fa++; while (la > 0 && thr[la] <= 1050) la--;
    const armed = new Uint8Array(rows); for (let i = fa; i <= la; i++) armed[i] = 1;
    const res = { fs, dur: t[rows - 1], findings: [], bursts: [], info: {}, stats: {} };
    const add = (lvl, title, body, jump) => res.findings.push({ lvl, title, body, jump });
    // disarm / modes / failsafe
    const dis = L.events.filter(e => e.type === 'DISARM');
    res.info.disarm = dis.length ? dis.map(d => DISARM[d.reason] || ('代碼 ' + d.reason)).join('、') : '無紀錄（可能是斷電或記錄中斷）';
    for (const d of dis) if ([1, 5, 6].includes(d.reason)) add('bad', '上鎖原因：' + DISARM[d.reason], d.reason === 1 ? '飛機是因為失控保護而上鎖，先檢查接收機訊號、天線與 RX 供電。' : d.reason === 5 ? '飛控判定墜機而自動上鎖。' : '飛控偵測到暴衝而上鎖，檢查馬達方向、槳方向與 IMU 安裝方向。', d.ts);
    const sn = L.slowNames, fsI = sn.indexOf('failsafePhase'), rxI = sn.indexOf('rxSignalReceived');
    const fsBad = L.slow.filter(s => (fsI >= 0 && s[fsI + 1] > 0) || (rxI >= 0 && s[rxI + 1] === 0));
    if (fsBad.length) add('bad', '接收機訊號中斷 / failsafe', `有 ${fsBad.length} 筆慢速紀錄顯示訊號遺失或進入 failsafe，第一次在 ${fsBad[0][0].toFixed(1)} 秒。`, fsBad[0][0]);
    // battery
    if (has('vbatLatest')) {
      const v = F['vbatLatest'], cur = F['amperageLatest'];
      const vs = median(v.subarray(0, Math.min(rows, Math.round(fs)))) / 100, cells = Math.max(1, Math.ceil(vs / 4.35));
      const vf = filtfilt(Float64Array.from(v), fs, 'lp', 25, 0.707); let vmin = 1e9, imax = 0; for (let i = 0; i < rows; i++) { if (armed[i] && vf[i] < vmin) vmin = vf[i]; if (cur && cur[i] > imax) imax = cur[i]; }
      vmin /= 100; imax /= 100;
      res.stats.batt = { vs, cells, vmin, imax, vend: median(v.subarray(Math.max(0, rows - Math.round(fs)))) / 100 };
      const pc = vmin / cells;
      if (pc < 3.0) add('warn', `電池壓降偏大：最低 ${pc.toFixed(2)} V/cell`, `${cells}S，起飛 ${vs.toFixed(2)} V，最低 ${vmin.toFixed(2)} V，峰值電流約 ${imax.toFixed(0)} A。壓降太深會讓馬達突然沒力，也傷電池。若同時有震盪，先處理震盪（馬達被打滿會造成瞬間大電流）。`);
      else add('ok', `電池正常：最低 ${pc.toFixed(2)} V/cell`, `${cells}S，起飛 ${vs.toFixed(2)} V，最低 ${vmin.toFixed(2)} V，峰值電流約 ${imax.toFixed(0)} A。`);
    }
    // motors
    const nm = [0, 1, 2, 3, 4, 5, 6, 7].filter(k => has(`motor[${k}]`)).length;
    const mo = (hdr['motorOutput'] || '0,2047').split(',').map(Number), mMax = mo[1] || 2047, mMin = mo[0] || 0;
    if (nm) {
      let sat = 0, na = 0; for (let i = 0; i < rows; i++) if (armed[i]) { na++; for (let k = 0; k < nm; k++) if (F[`motor[${k}]`][i] >= mMax - 2) { sat++; break; } }
      res.stats.sat = na ? sat / na : 0;
      if (res.stats.sat > 0.02) add('warn', `馬達頂到上限 ${(res.stats.sat * 100).toFixed(1)}% 的時間`, '馬達常被打到 100%，代表動力餘量不足或有震盪讓輸出被頂滿；這段時間飛控無法完全控制姿態。');
      if (nm === 4) {
        const cr = []; const sp0 = F['setpoint[0]'], sp1 = F['setpoint[1]'];
        for (let i = 0; i < rows; i++) if (armed[i] && Math.abs(sp0[i]) < 30 && Math.abs(sp1[i]) < 30) cr.push(i);
        if (cr.length > fs) {
          const md = [0, 1, 2, 3].map(k => median(cr.map(i => F[`motor[${k}]`][i])));
          const rf = (md[0] + md[2]) / (md[1] + md[3]), lr = (md[2] + md[3]) / (md[0] + md[1]);
          res.stats.balance = { md, rf, lr };
          if (rf > 1.12 || rf < 0.89) add('warn', `重心偏${rf > 1 ? '後' : '前'}：${rf > 1 ? '後' : '前'}馬達多出 ${(Math.abs(rf - 1) * 100).toFixed(0)}% 輸出`, `平飛時馬達中位數（後右/前右/後左/前左）＝ ${md.map(x => x.toFixed(0)).join(' / ')}。把電池或相機往${rf > 1 ? '前' : '後'}移，讓四顆馬達負擔接近，可以多留一些控制餘量。`);
          else add('ok', '重心前後平衡', `前後輸出比 ${rf.toFixed(2)}。`);
          if (lr > 1.12 || lr < 0.89) add('warn', `左右不平衡：${lr > 1 ? '左' : '右'}側馬達多出 ${(Math.abs(lr - 1) * 100).toFixed(0)}%`, '可能是重心偏一側、某支槳受損或馬達較弱。');
        }
      }
      // desync
      if (has('eRPM[0]')) {
        let evs = [];
        for (let k = 0; k < nm; k++) {
          const m = F[`motor[${k}]`], e = F[`eRPM[${k}]`]; let run = 0, st = 0;
          for (let i = 0; i < rows; i++) {
            let o = 0; for (let j = 0; j < nm; j++) if (j !== k) o += F[`eRPM[${j}]`][i]; o /= (nm - 1);
            const bad = armed[i] && m[i] > (mMax - mMin) * 0.5 + mMin && e[i] < o * 0.45;
            if (bad) { if (!run) st = i; run++; } else { if (run > fs * 0.02) evs.push({ k, t: t[st], d: run / fs }); run = 0; }
          }
        }
        res.stats.desync = evs;
        if (evs.length) add('bad', `疑似馬達失步 (desync)：${evs.length} 次`, evs.slice(0, 5).map(e => `M${e.k + 1} 在 ${e.t.toFixed(2)} 秒`).join('、') + '。高輸出時轉速卻掉很多，檢查該馬達、電調、焊點，或在電調調整 timing / demag。', evs[0].t);
        else add('ok', '沒有馬達失步', '高輸出時四顆馬達轉速都跟得上指令。');
      }
    }
    // oscillation bursts
    const ag = Number(hdr['anti_gravity_p_gain'] || 0);
    let dthr = new Float64Array(rows); for (let i = 1; i < rows; i++) dthr[i] = Math.abs(thr[i] - thr[i - 1]) * fs; dthr = filtfilt(dthr, fs, 'lp', 3, 0.707);
    const dArm = []; for (let i = 0; i < rows; i++) if (armed[i]) dArm.push(dthr[i]); const dHi = pct(dArm, 0.8);
    res.osc = [];
    for (let ax = 0; ax < 3; ax++) {
      const g = F[`gyroADC[${ax}]`], sp = F[`setpoint[${ax}]`]; if (!g) continue;
      const bp = band(g, fs, 15, 50), env = envelope(bp, fs, 0.06);
      let sHi = 0, nHi = 0, sLo = 0, nLo = 0;
      for (let i = 0; i < rows; i++) if (armed[i] && Math.abs(sp[i]) < 60) { if (dthr[i] > dHi) { sHi += env[i]; nHi++; } else { sLo += env[i]; nLo++; } }
      res.osc.push({ ax, chg: nHi ? sHi / nHi : 0, steady: nLo ? sLo / nLo : 0 });
      let i = 0;
      while (i < rows) {
        if (env[i] > 12 && armed[i]) {
          let j = i; while (j < rows && env[j] > 12) j++;
          if (t[j - 1] - t[i] > 0.15) {
            let zc = 0, amp = 0, th = 0, stick = false;
            for (let q = i + 1; q < j; q++) { if ((bp[q - 1] < 0) !== (bp[q] < 0)) zc++; amp = Math.max(amp, Math.abs(bp[q])); th += thr[q]; }
            for (let a2 = 0; a2 < 3; a2++) { const s2 = F[`setpoint[${a2}]`]; let lo = 1e9, hi = -1e9; for (let q = i; q < j; q++) { lo = Math.min(lo, s2[q]); hi = Math.max(hi, s2[q]); } if (hi - lo > 150) stick = true; }
            const freq = zc / 2 / (t[j - 1] - t[i]);
            res.bursts.push({ ax, t0: t[i], t1: t[j - 1], amp, freq, thr: th / (j - i), stick });
          }
          i = j;
        } else i++;
      }
    }
    const pure = res.bursts.filter(b => !b.stick);
    if (pure.length) {
      const byAx = [0, 1, 2].map(a => pure.filter(b => b.ax === a));
      const main = byAx.map((b, a) => [b.length, a]).sort((x, y) => y[0] - x[0])[0][1];
      const fr = median(pure.map(b => b.freq)), big = pure.reduce((a, b) => b.amp > a.amp ? b : a);
      const o = res.osc[main], ratio = o.steady ? o.chg / o.steady : 0;
      let body = `在沒有打桿時偵測到 ${pure.length} 次低頻震盪，主要在 ${AXN[main]} 軸（${byAx.map((b, a) => AXN[a] + ' ' + b.length).join('、')}），頻率約 ${fr.toFixed(0)} Hz，最大 ±${big.amp.toFixed(0)}°/s（${big.t0.toFixed(1)} 秒）。`;
      if (ratio > 1.8) body += ` 油門變化時震盪強度是油門穩定時的 ${ratio.toFixed(1)} 倍，${ag > 0 ? `很可能是 anti-gravity 在油門變化時加大 P（目前 anti_gravity_p_gain = ${ag}）把迴路推過穩定邊緣。可先試 set anti_gravity_p_gain = 0 或 50 比較。` : '油門變化是主要觸發點。'}`;
      body += fr < 60 ? ` 這個頻段（15–50 Hz）屬於控制迴路範圍，常見原因是 P 對該軸偏高、D 阻尼不足，或電池／飛控減震鬆動。降低 ${AXN[main]} P 約 10–15% 再測。` : '';
      add(big.amp > 80 ? 'bad' : 'warn', `${AXN[main]} 軸低頻震盪（約 ${fr.toFixed(0)} Hz）`, body, big.t0);
    } else add('ok', '沒有明顯低頻震盪', '在沒有打桿的時候，三軸都沒有超過 ±12°/s 的 15–50 Hz 晃動。');
    // tracking + noise
    res.noise = [];
    for (let ax = 0; ax < 3; ax++) {
      const gk = has(`gyroUnfilt[${ax}]`) ? `gyroUnfilt[${ax}]` : `gyroADC[${ax}]`; if (!F[gk]) continue;
      const seg = []; const g = F[gk]; for (let i = 0; i < rows; i++) if (armed[i]) seg.push(g[i]);
      const w = welch(seg, fs, 1024); let tot = 0, pk = 0, pf = 0;
      for (let k = 0; k < w.P.length; k++) { const f = k * w.df; if (f > 80) { tot += w.P[k]; if (w.P[k] > pk) { pk = w.P[k]; pf = f; } } }
      const scale = 2 / (fs * 1024 * 0.375); // hann
      res.noise.push({ ax, key: gk, w, rms: Math.sqrt(tot * scale * w.df), peak: pf });
    }
    const nr = res.noise.slice(0, 2).map(n => n.rms); const nmax = Math.max(...nr, 0);
    if (nmax > 12) add('warn', `陀螺儀高頻雜訊偏高（${nmax.toFixed(1)}°/s RMS）`, `主要雜訊峰在 ${res.noise.map(n => AXN[n.ax] + ' ' + n.peak.toFixed(0) + ' Hz').join('、')}。檢查槳是否變形、馬達軸承、機臂與螺絲是否鬆動。`);
    else add('ok', `陀螺儀雜訊低（${nmax.toFixed(1)}°/s RMS）`, `最高峰在 ${res.noise.map(n => AXN[n.ax] + ' ' + n.peak.toFixed(0) + ' Hz').join('、')}，濾波狀況良好，機架與槳沒有明顯高頻問題。`);
    const order = { bad: 0, warn: 1, ok: 2 }; res.findings.sort((a, b) => order[a.lvl] - order[b.lvl]);
    return res;
  }
  return { analyze, AXN, DISARM };
})();
if (typeof module !== 'undefined') module.exports = AN;
