// 航線轉彎輔助：在五邊轉彎點／8 字圓周自動壓副翼並補升降舵，直線段只做輕微修正
// 玩家搖桿打越多，輔助越淡出
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function routeAssistCore(fm, input, pts, len, opt, RA) {
  const N = pts.length;
  let best = 0, bd = 1e18;
  for (let i = 0; i < N; i++) { const dx = pts[i][0] - fm.pos.x, dz = pts[i][1] - fm.pos.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
  const e = fm.euler();
  const hx = -Math.sin(e.y), hz = -Math.cos(e.y);
  const at = k => pts[((best + k) % N + N) % N];
  const n3 = at(3), nx = n3[0] - pts[best][0], nz = n3[1] - pts[best][1];
  let dir = 1;
  if (opt.eight) dir = (hx * nx + hz * nz) >= 0 ? 1 : -1;
  else if (hx * nx + hz * nz < -0.3 * Math.hypot(nx, nz)) return; // 逆向飛行時不介入
  const step = len / N;
  const ahead = Math.round((opt.eight ? Math.max(14, fm.airspeed * 1.1) : Math.max(22, fm.airspeed * 1.8)) / step);
  const tp = at(dir * ahead);
  const t0 = at(dir * 2), t1 = at(dir * Math.round(ahead * 1.6));
  const a0 = Math.atan2(t0[0] - pts[best][0], t0[1] - pts[best][1]), a1 = Math.atan2(t1[0] - tp[0], t1[1] - tp[1]);
  const turn = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
  RA.corner = turn > 0.25 || !!opt.eight;
  const lvl = input.assistLvl ?? 1; // 輔助強度 0~1
  const w = (RA.corner ? 1 : 0.35) * lvl;
  // 期望航向 → 期望坡度（左轉為正，與 euler.z 同號）
  const want = Math.atan2(-(tp[0] - fm.pos.x), -(tp[1] - fm.pos.z));
  const err = Math.atan2(Math.sin(want - e.y), Math.cos(want - e.y));
  const maxB = (opt.eight ? 45 : 35) * Math.PI / 180;
  const dB = clamp(err * 1.4, -maxB, maxB);
  const rate = input.rate || 1;
  const ailA = input.stab ? -dB / (50 * Math.PI / 180) * rate : clamp((e.z - dB) * 2.2, -1, 1) * rate;
  if (RA.corner && RA.altHold == null) RA.altHold = fm.pos.y;
  if (!RA.corner) RA.altHold = null;
  let eleA = 0;
  if (RA.corner) {
    const bankComp = Math.min(0.6, Math.abs(e.z)) * (input.stab ? 0 : 0.35);
    const hold = opt.descending || RA.altHold == null ? 0 : clamp((RA.altHold - fm.pos.y) * 0.08 - fm.vel.y * 0.12, -0.25, 0.25);
    eleA = (bankComp + hold) * rate * lvl;
  }
  // 玩家搖桿越大，輔助越淡出（0～30% 之間平滑過渡），不會突然斷開
  const fadeA = clamp(1 - Math.abs(input.ail) / (0.3 * rate), 0, 1), fadeE = clamp(1 - Math.abs(input.ele) / (0.3 * rate), 0, 1);
  input.ail += (ailA - input.ail) * w * fadeA;
  if (RA.corner) input.ele += eleA * fadeE;
  RA.active = true;
}
