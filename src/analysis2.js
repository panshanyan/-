// ---- PIDtoolbox-style tools: spectra, step response, PID error, stats, delay, narrative ----
const PT = (() => {
  const { fftc, hann } = (() => {
    function fftc(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < h; j++) { const p = i + j, q = p + h, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr; re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
    const cache = {}; const hann = N => cache[N] || (cache[N] = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))));
    return { fftc, hann };
  })();
  const AXN = ['Roll', 'Pitch', 'Yaw'];
  function fsOf(L) { return (L.rows - 1) / (L.t[L.rows - 1] - L.t[0]); }
  function flying(L) { const thr = L.F['rcCommand[3]'], n = L.rows; let a = 0, b = n - 1; while (a < n && thr[a] <= 1050) a++; while (b > 0 && thr[b] <= 1050) b--; return [a, Math.max(a, b)]; }
  function thrPct(L) { const s = L.F['setpoint[3]'], r = L.F['rcCommand[3]']; return s ? i => Math.max(0, Math.min(100, s[i] / 10)) : i => Math.max(0, Math.min(100, (r[i] - 1000) / 10)); }
  // variable getters
  const VARS = {
    gyroUnfilt: { name: '陀螺（未濾波）', get: (L, ax) => L.F[`gyroUnfilt[${ax}]`] || L.F[`gyroADC[${ax}]`] },
    gyro: { name: '陀螺（濾波後）', get: (L, ax) => L.F[`gyroADC[${ax}]`] },
    dterm: { name: 'D 項', get: (L, ax) => L.F[`axisD[${ax}]`] },
    error: { name: 'PID 誤差', get: (L, ax) => { const s = L.F[`setpoint[${ax}]`], g = L.F[`gyroADC[${ax}]`]; if (!s) return null; const e = new Float64Array(L.rows); for (let i = 0; i < L.rows; i++) e[i] = s[i] - g[i]; return e; } },
    setpoint: { name: '搖桿指令', get: (L, ax) => L.F[`setpoint[${ax}]`] },
    motor: { name: '馬達輸出', get: (L, ax) => L.F[`motor[${ax}]`] },
  };
  // throttle x frequency heatmap
  function heat(L, varKey, ax, low) {
    const x = VARS[varKey].get(L, ax); if (!x) return null;
    const fs = fsOf(L), N = low ? 1024 : 256, hop = N >> 2, w = hann(N), tp = thrPct(L), [a, b] = flying(L);
    const TB = 50, fmax = low ? 100 : fs / 2, nf = Math.min(N / 2, Math.floor(fmax / (fs / N)) + 1);
    const acc = new Float64Array(TB * nf), cnt = new Float64Array(TB), re = new Float64Array(N), im = new Float64Array(N);
    for (let s = a; s + N <= b; s += hop) {
      let m = 0, th = 0; for (let i = 0; i < N; i++) { m += x[s + i]; th += tp(s + i); } m /= N; th /= N;
      for (let i = 0; i < N; i++) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; }
      fftc(re, im); const tb = Math.min(TB - 1, Math.floor(th / 100 * TB)); cnt[tb]++;
      for (let k = 0; k < nf; k++) acc[tb * nf + k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]) * 2 / (N * 0.5);
    }
    for (let t = 0; t < TB; t++) if (cnt[t]) for (let k = 0; k < nf; k++) acc[t * nf + k] /= cnt[t];
    // fill sparse throttle bins from neighbours (within 3 bins) so the map reads continuously
    const has = Array.from(cnt, c => c > 0), fill = new Float64Array(TB);
    for (let t = 0; t < TB; t++) if (!has[t]) { let lo = -1, hi = -1; for (let d = 1; d <= 3; d++) { if (lo < 0 && t - d >= 0 && has[t - d]) lo = t - d; if (hi < 0 && t + d < TB && has[t + d]) hi = t + d; }
      if (lo >= 0 && hi >= 0) { const w = (t - lo) / (hi - lo); for (let k = 0; k < nf; k++) acc[t * nf + k] = acc[lo * nf + k] * (1 - w) + acc[hi * nf + k] * w; fill[t] = 1; } }
    for (let t = 0; t < TB; t++) if (fill[t]) cnt[t] = 0.5;
    return { z: acc, TB, nf, df: fs / N, cnt, fmax: (nf - 1) * fs / N };
  }
  // averaged 1-D spectrum (amplitude) on flying segment
  function spectrum(L, varKey, ax, N = 2048) {
    const x = VARS[varKey].get(L, ax); if (!x) return null;
    const fs = fsOf(L), w = hann(N), [a, b] = flying(L), P = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N); let c = 0;
    for (let s = a; s + N <= b; s += N >> 1) { let m = 0; for (let i = 0; i < N; i++) m += x[s + i]; m /= N; for (let i = 0; i < N; i++) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; } fftc(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; c++; }
    for (let k = 0; k < N / 2; k++) P[k] = c ? Math.sqrt(P[k] / c) * 2 / (N * 0.5) : 0;
    return { P, df: fs / N };
  }
  // step response via Wiener deconvolution (PIDtoolbox style)
  function step(L, ax, opts = {}) {
    const sp = L.F[`setpoint[${ax}]`], g = L.F[`gyroADC[${ax}]`]; if (!sp || !g) return null;
    const fs = fsOf(L), N = 1 << Math.round(Math.log2(fs * 2)), hop = N >> 2, w = hann(N), [a, b] = flying(L);
    const keep = Math.round(0.5 * fs), minIn = opts.minIn || 20, maxIn = opts.maxIn || 500;
    const sr = new Float64Array(N), si = new Float64Array(N), gr = new Float64Array(N), gi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
    const sum = new Float64Array(keep); let n = 0; const all = [];
    for (let s = a; s + N <= b; s += hop) {
      let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(sp[s + i]));
      if (mx < minIn || mx > maxIn) continue;
      for (let i = 0; i < N; i++) { sr[i] = sp[s + i] * w[i]; si[i] = 0; gr[i] = g[s + i] * w[i]; gi[i] = 0; }
      fftc(sr, si); fftc(gr, gi);
      let pw = 0; for (let k = 0; k < N; k++) pw += sr[k] * sr[k] + si[k] * si[k]; const reg = pw / N * 0.0001 + 1e-9;
      for (let k = 0; k < N; k++) { const d = sr[k] * sr[k] + si[k] * si[k] + reg; hr[k] = (gr[k] * sr[k] + gi[k] * si[k]) / d; hi[k] = -(gr[k] * si[k] - gi[k] * sr[k]) / d; }
      // inverse FFT via conj trick
      for (let k = 0; k < N; k++) hi[k] = -hi[k]; fftc(hr, hi);
      const st = new Float64Array(keep); let c = 0; for (let i = 0; i < keep; i++) { c += hr[i] / N; st[i] = c; }
      let ss = 0; const q = Math.round(0.2 * fs); for (let i = q; i < keep; i++) ss += st[i]; ss /= (keep - q);
      if (ss < 0.5 || ss > 3) continue;
      for (let i = 0; i < keep; i++) st[i] /= ss;
      all.push(st); for (let i = 0; i < keep; i++) sum[i] += st[i]; n++;
    }
    if (!n) return { n: 0 };
    const y = sum.map(v => v / n), dt = 1000 / fs;
    let pk = 0, pki = 0; const pkEnd = Math.min(keep, Math.round(0.15 * fs)); for (let i = 0; i < pkEnd; i++) if (y[i] > pk) { pk = y[i]; pki = i; }
    let ss = 0; const q = Math.round(0.2 * fs); for (let i = q; i < keep; i++) ss += y[i]; ss /= (keep - q);
    let t50 = 0; for (let i = 0; i < keep; i++) if (y[i] >= 0.5 * ss) { t50 = i * dt; break; }
    let t90 = 0; for (let i = 0; i < keep; i++) if (y[i] >= 0.9 * ss) { t90 = i * dt; break; }
    return { y, dt, n, peak: pk / ss, peakT: pki * dt, t50, t90, ss };
  }
  // mean |PID error| vs throttle bands
  function errVsThr(L, maxStick = 100) {
    const tp = thrPct(L), [a, b] = flying(L), bands = 10, out = [];
    for (let ax = 0; ax < 3; ax++) {
      const s = L.F[`setpoint[${ax}]`], g = L.F[`gyroADC[${ax}]`], sum = new Float64Array(bands), c = new Float64Array(bands); let ts = 0, tc = 0;
      for (let i = a; i <= b; i++) { if (Math.abs(s[i]) > maxStick) continue; const e = Math.abs(s[i] - g[i]), k = Math.min(bands - 1, Math.floor(tp(i) / 10)); sum[k] += e; c[k]++; ts += e; tc++; }
      out.push({ ax, bands: Array.from(sum, (v, k) => c[k] > 50 ? v / c[k] : null), mean: tc ? ts / tc : 0 });
    }
    return out;
  }
  // filter delay by cross-correlation (ms)
  function xdelay(x, y, a, b, maxLag) {
    let best = -1e18, bl = 0; const cs = [];
    for (let L = 0; L <= maxLag; L++) { let s = 0; for (let i = a; i + L <= b; i++) s += x[i] * y[i + L]; cs.push(s); if (s > best) { best = s; bl = L; } }
    if (bl > 0 && bl < maxLag) { const y0 = cs[bl - 1], y1 = cs[bl], y2 = cs[bl + 1], d = (y0 - 2 * y1 + y2); if (d) return bl + 0.5 * (y0 - y2) / d; }
    return bl;
  }
  function delays(L) {
    const fs = fsOf(L), [a, b] = flying(L), out = {}, ml = Math.round(fs * 0.02), e = Math.min(b, a + Math.round(fs * 60));
    const gu = L.F['gyroUnfilt[0]'], gf = L.F['gyroADC[0]'], d = L.F['axisD[0]'];
    if (gu && gf) out.gyro = xdelay(gu, gf, a, e, ml) / fs * 1000;
    if (d && gf) { const dg = new Float64Array(L.rows); for (let i = 1; i < L.rows; i++) dg[i] = -(gf[i] - gf[i - 1]); out.dterm = xdelay(dg, d, a, e, ml) / fs * 1000 + (out.gyro || 0); }
    return out;
  }
  function stats(L) {
    const [a, b] = flying(L), tp = thrPct(L), nm = [0, 1, 2, 3, 4, 5, 6, 7].filter(k => L.F[`motor[${k}]`]).length;
    const mo = (L.hdr.motorOutput || '0,2047').split(',').map(Number), lo = mo[0], hi = mo[1];
    const thrH = new Float64Array(20), motH = [...Array(nm)].map(() => new Float64Array(20)), stick = [0, 1, 2].map(() => new Float64Array(20));
    let full = 0, n = 0, thrSum = 0;
    for (let i = a; i <= b; i++) {
      const t = tp(i); thrH[Math.min(19, Math.floor(t / 5))]++; thrSum += t; n++; if (t > 95) full++;
      for (let k = 0; k < nm; k++) motH[k][Math.min(19, Math.max(0, Math.floor((L.F[`motor[${k}]`][i] - lo) / (hi - lo) * 20)))]++;
      for (let ax = 0; ax < 3; ax++) stick[ax][Math.min(19, Math.floor(Math.abs(L.F[`setpoint[${ax}]`][i]) / 50))]++;
    }
    const norm = h => Array.from(h, v => n ? v / n * 100 : 0);
    return { thrH: norm(thrH), motH: motH.map(norm), stick: stick.map(norm), thrMean: n ? thrSum / n : 0, fullPct: n ? full / n * 100 : 0, flyDur: (L.t[b] - L.t[a]) };
  }
  // ---- human-friendly narrative ----
  function grade(v, good, bad) { return v <= good ? 'good' : v >= bad ? 'bad' : 'mid'; }
  function insight(L, R, X) {
    const h = L.hdr, s = [], cli = [], cards = [];
    const steps = X.steps, err = X.err, pure = R.bursts.filter(b => !b.stick);
    const ag = Number(h.anti_gravity_p_gain || 0), simp = Number(h.simplified_pids_mode || 0) > 0;
    const pid = ax => (h[['rollPID', 'pitchPID', 'yawPID'][ax]] || '0,0,0').split(',').map(Number);
    // scores 0-100
    const trk = (err[0].mean + err[1].mean) / 2;
    const scT = Math.max(0, Math.min(100, Math.round(100 - (trk - 1.5) * 12)));
    const oscAmp = pure.length ? Math.max(...pure.map(b => b.amp)) : 0;
    const scO = Math.max(0, Math.min(100, Math.round(100 - pure.length * 6 - oscAmp * 0.3)));
    const nz = Math.max(...R.noise.slice(0, 2).map(n => n.rms), 0);
    const scN = Math.max(0, Math.min(100, Math.round(100 - (nz - 3) * 6)));
    const b = R.stats.batt, bal = R.stats.balance;
    let scH = 100; if (bal) scH -= Math.min(40, Math.abs(bal.rf - 1) * 150 + Math.abs(bal.lr - 1) * 150); if (R.stats.desync && R.stats.desync.length) scH -= 40; if (b && b.vmin / b.cells < 3.0) scH -= 20; scH = Math.max(0, Math.round(scH));
    cards.push({ k: '追蹤精準度', v: scT, d: `平均誤差 ${trk.toFixed(1)}°/s` }, { k: '平順度', v: scO, d: pure.length ? `${pure.length} 次非操作震盪` : '沒有震盪' }, { k: '雜訊', v: scN, d: `${nz.toFixed(1)}°/s RMS` }, { k: '機體與電力', v: scH, d: bal ? `前後比 ${bal.rf.toFixed(2)}` : '—' });
    const total = Math.round((scT + scO + scN + scH) / 4);
    // headline
    let head;
    if (pure.length && scO < 75) head = '這台飛機整體飛得不錯，但有一個明顯的毛病：油門變化時會抖。';
    else if (total >= 80) head = '這次飛行狀況很健康，調參大致到位。';
    else if (total >= 60) head = '整體可以飛，但有幾個地方值得調整，會讓手感更穩更跟手。';
    else head = '這份 log 顯示飛機有幾個比較明顯的問題，建議先處理再繼續調參。';
    // main issue paragraph
    if (pure.length) {
      const byAx = [0, 1, 2].map(a => pure.filter(x => x.ax === a).length), main = byAx.indexOf(Math.max(...byAx));
      const fr = pure.map(x => x.freq).sort((a, c) => a - c)[pure.length >> 1], o = R.osc[main], ratio = o && o.steady ? o.chg / o.steady : 0;
      let p = `最需要先處理的是 ${AXN[main]} 軸大約 ${fr.toFixed(0)} Hz 的晃動，這次飛行出現 ${pure.length} 次，最大到 ±${oscAmp.toFixed(0)}°/s。你在影片裡可能會看到推油或收油時畫面「抖一下」或左右搖擺。`;
      if (ratio > 1.8) p += ` 它幾乎都發生在油門變化的時候（強度是穩定油門時的 ${ratio.toFixed(1)} 倍），這通常是 anti-gravity 在油門變化時把 P 加大，把本來就接近邊緣的 ${AXN[main]} 推過頭。`;
      s.push({ t: '先處理這個', p });
      if (ratio > 1.8 && ag > 0) cli.push({ c: `set anti_gravity_p_gain = ${ag > 50 ? 50 : 0}`, why: '降低油門變化時額外加的 P，先單獨改這一項測試' });
      const P = pid(main)[0]; if (P) cli.push({ c: `set p_${['roll', 'pitch', 'yaw'][main]} = ${Math.round(P * 0.88)}`, why: `${AXN[main]} P 降約 12%，如果上一條沒完全解決再加這條` });
    }
    // step response paragraph
    const sr = steps.map((x, ax) => x && x.n ? { ax, ...x } : null).filter(Boolean).filter(x => x.ax < 2);
    if (sr.length) {
      const parts = sr.map(x => `${AXN[x.ax]} 反應時間 ${x.t50.toFixed(0)} ms、${x.peak > 1.02 ? '過衝 ' + ((x.peak - 1) * 100).toFixed(0) + '%' : '沒有過衝'}`);
      let p = `從步階響應來看：${parts.join('；')}。`;
      if (X.angle > 0.5) p += ' （這次大多在自穩模式飛，指令是由角度控制器產生的，步階響應的參考價值比手動模式低，建議用手動模式的 log 來判斷 P/D。）';
      const over = sr.filter(x => x.peak > 1.15), slow = sr.filter(x => x.t50 > 35), flat = sr.filter(x => x.peak < 0.97);
      if (over.length) { p += ` ${over.map(x => AXN[x.ax]).join('、')} 過衝偏多，打桿停下來時會有一點回彈，可以稍微提高 D 或降低 P。`; over.forEach(x => { const D = pid(x.ax)[2]; if (D) cli.push({ c: `set d_${['roll', 'pitch'][x.ax]} = ${Math.round(D * 1.1)}`, why: `${AXN[x.ax]} 過衝 ${((x.peak - 1) * 100).toFixed(0)}%，D 提高約 10% 增加阻尼` }); }); }
      else if (slow.length) p += ` ${slow.map(x => AXN[x.ax]).join('、')} 反應偏慢，如果你覺得不夠跟手，可以提高 feedforward。`;
      else if (flat.length) p += ' 響應有點軟，到不了指令的速度，I 或 feedforward 可能偏低。';
      else p += ' 這個響應形狀很漂亮，跟手又不回彈，P/D 的比例是合適的。';
      s.push({ t: '跟手程度', p });
    }
    // noise
    s.push({ t: '雜訊與濾波', p: nz < 8 ? `陀螺儀雜訊很低（${nz.toFixed(1)}°/s），表示槳、馬達、機架都沒有高頻問題，濾波也夠用${X.delay.gyro ? `，目前陀螺濾波延遲約 ${X.delay.gyro.toFixed(1)} ms` : ''}。這部分不用動。` : `陀螺儀雜訊偏高（${nz.toFixed(1)}°/s），主峰在 ${R.noise.map(n => n.peak.toFixed(0) + ' Hz').join('、')}。先檢查槳有沒有撞歪、馬達有沒有異音、螺絲有沒有鬆，再考慮加濾波。` });
    // body / power
    const bp = [];
    if (bal && (bal.rf > 1.12 || bal.rf < 0.89)) bp.push(`重心偏${bal.rf > 1 ? '後' : '前'}，${bal.rf > 1 ? '後' : '前'}面兩顆馬達平常就多出 ${(Math.abs(bal.rf - 1) * 100).toFixed(0)}% 的力氣，翻滾和急停時可用的餘量會變少，把電池往${bal.rf > 1 ? '前' : '後'}挪一點就能改善`);
    if (R.stats.desync && R.stats.desync.length) bp.push(`偵測到 ${R.stats.desync.length} 次疑似馬達失步，這個要優先檢查馬達和電調`);
    else bp.push('四顆馬達都跟得上指令，沒有失步');
    if (b) bp.push(b.vmin / b.cells < 3.0 ? `電池最低掉到 ${(b.vmin / b.cells).toFixed(2)} V/cell，壓降偏深，猛推時可能會突然沒力` : `電池表現正常（最低 ${(b.vmin / b.cells).toFixed(2)} V/cell）`);
    s.push({ t: '機體與電力', p: bp.join('；') + '。' });
    // disarm
    const fsBad = R.findings.find(f => f.lvl === 'bad' && /failsafe|訊號|上鎖原因/.test(f.title));
    if (fsBad) s.unshift({ t: '安全', p: fsBad.body });
    if (simp && cli.some(c => /^set [pd]_/.test(c.c))) cli.push({ c: 'set simplified_pids_mode = OFF', why: '你開著簡易調參滑桿，直接改 P/D 前要先關掉，否則之後動滑桿會被覆蓋（或改用滑桿調）' });
    if (cli.length) cli.push({ c: 'save', why: '儲存並重新開機' });
    return { head, total, cards, sections: s, cli };
  }
  function compare(A, B) {
    const out = [];
    const ea = (A.X.err[0].mean + A.X.err[1].mean) / 2, eb = (B.X.err[0].mean + B.X.err[1].mean) / 2;
    const d = (eb - ea) / ea * 100;
    out.push(`追蹤誤差：B 比 A ${d < 0 ? '降低' : '增加'} ${Math.abs(d).toFixed(0)}%（${ea.toFixed(1)} → ${eb.toFixed(1)}°/s）${Math.abs(d) < 5 ? '，差不多' : d < 0 ? '，B 比較跟手' : '，A 比較跟手'}。`);
    const pa = A.R.bursts.filter(b => !b.stick), pb = B.R.bursts.filter(b => !b.stick);
    const ma = pa.length ? Math.max(...pa.map(b => b.amp)) : 0, mb = pb.length ? Math.max(...pb.map(b => b.amp)) : 0;
    out.push(`非操作震盪：A ${pa.length} 次（最大 ±${ma.toFixed(0)}°/s），B ${pb.length} 次（最大 ±${mb.toFixed(0)}°/s）${pb.length < pa.length && mb < ma ? '，B 改善了' : pb.length > pa.length || mb > ma * 1.2 ? '，B 變差了' : ''}。`);
    for (let ax = 0; ax < 2; ax++) { const sa = A.X.steps[ax], sb = B.X.steps[ax]; if (sa && sb && sa.n && sb.n) out.push(`${AXN[ax]} 步階：過衝 ${((sa.peak - 1) * 100).toFixed(0)}% → ${((sb.peak - 1) * 100).toFixed(0)}%，反應 ${sa.t50.toFixed(0)} → ${sb.t50.toFixed(0)} ms。`); }
    if ((A.X.angle > 0.5) !== (B.X.angle > 0.5)) out.push(`注意：${A.X.angle > 0.5 ? 'A' : 'B'} 主要是自穩模式、${A.X.angle > 0.5 ? 'B' : 'A'} 是手動模式，飛法不同，步階響應和誤差只能粗略比較。`);
    const keys = Object.keys(A.L.hdr).filter(k => !/^(Field|Log start|vbatref|H |Product|Data version|DeviceUID|Firmware date)/.test(k) && A.L.hdr[k] !== B.L.hdr[k] && B.L.hdr[k] != null && !/rc_smoothing_(rx|active)/.test(k));
    if (keys.length) out.push('設定差異：' + keys.slice(0, 12).map(k => `${k} ${A.L.hdr[k]} → ${B.L.hdr[k]}`).join('；') + '。');
    return out;
  }
  function angleShare(L) { const sl = L.slow, i = L.slowNames.indexOf('flightModeFlags'); if (i < 0 || !sl.length) return 0; return sl.filter(r => r[i + 1] & 2).length / sl.length; }
  function run(L) {
    const steps = [0, 1, 2].map(ax => step(L, ax));
    return { steps, err: errVsThr(L), delay: delays(L), stats: stats(L), angle: angleShare(L) };
  }
  return { VARS, heat, spectrum, step, errVsThr, delays, stats, insight, compare, run, AXN };
})();
if (typeof module !== 'undefined') module.exports = PT;
