// 考照模式：依交通部民航局「無人飛機專業操作證術科測驗基準」（附錄 2）基本級程序模擬
// A 飛行前檢查 → B 地面滑行及轉彎 → C 起飛航線 → D 高度保持五邊飛行（含水平 8 字）
// → E 降落航線及落地 → F 緊急程序處置（第二次起飛 + 怠速迫降）→ G 飛行後檢查
// 場地（I 級）：中線＝飛手正前方；起飛線距中線 30 m；主輪不得超出 4 m 寬範圍線
// 飛手站在跑道東側面向西，頂風方向為北（-Z），航線為左航線，位於飛手前方（西側）

import { PILOT, RUNWAY } from './world.js';

const D = 180 / Math.PI;
// 練習模式：不指定高度，只要求飛機保持在看得清楚的目視範圍內
let PRACTICE = false;
export const isPractice = () => PRACTICE;
export const VIS = { dist: 280, alt: 120 };
const visOut = c => c.alt > VIS.alt || Math.hypot(c.fm.pos.x - PILOT.x, c.fm.pos.z - PILOT.z) > VIS.dist;
export const phaseText = ph => PRACTICE ? ph.text.replace(/[，並]?保持(航高|高度)/g, '') : ph.text;
export const BAND = [20, 40];                          // 航高保持範圍 (m)（基準未訂數值，模擬採 30±10 m）
export const LINES = { center: PILOT.z, takeoff: 30, lane: 2 }; // 中線 z、起飛線距中線、範圍線半寬
export const PAT = { xFar: -100, zN: -160, zS: 150 };  // 五邊航線
export const C8 = { x: PILOT.x - 50, z: PILOT.z, r: 40 }; // 水平 8 字：交叉點 P5 在飛手正前方約 50 m
const zc = LINES.center, zT = LINES.takeoff;
const ON_RUNWAY = p => Math.abs(p.x) < RUNWAY.width / 2 + 0.5 && Math.abs(p.z) < 72;
const d8 = p => Math.hypot(p.x - C8.x, p.z - C8.z);
const wrapDeg = a => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

function trackAlt(c, S) {
  if (PRACTICE) { if (!c.fm.onGround && visOut(c)) S.vis = (S.vis || 0) + c.dt; return; }
  if (!S.tracking) return;
  if (c.alt < BAND[0] || c.alt > BAND[1]) S.out = (S.out || 0) + c.dt;
  S.minAlt = Math.min(S.minAlt ?? 999, c.alt);
}
function trackSmooth(c, S) {
  if (Math.abs(c.roll) > 65) S.bigRoll = true;
  if (Math.abs(c.pitch) > 35) S.bigPitch = true;
}
const altHint = (c, S) => PRACTICE ? `高度 ${c.alt.toFixed(0)} m · 距離 ${Math.hypot(c.fm.pos.x - PILOT.x, c.fm.pos.z - PILOT.z).toFixed(0)} m` + (visOut(c) ? ' · ⚠️ 太遠了，飛回來！' : '') : `高度 ${c.alt.toFixed(0)} m（保持 ${BAND[0]}–${BAND[1]}）` + (S.tracking ? ` · 超出 ${(S.out || 0).toFixed(1)} 秒` : '');
function altDeduct(S, n) {
  if (PRACTICE) { const v = S.vis || 0; if (v > 1) { n.push(`飛出目視範圍 ${v.toFixed(1)} 秒`); return Math.min(40, Math.round(v * 5)); } return 0; }
  let p = 0; const out = S.out || 0;
  if (out > 0.5) { p += Math.min(50, Math.round(out * 4)); n.push(`航高超出範圍 ${out.toFixed(1)} 秒`); }
  if ((S.minAlt ?? 99) < 10) { p += 20; n.push('航高過低'); }
  return p;
}
function smoothDeduct(S, n) {
  let p = 0;
  if (S.bigRoll) { p += 10; n.push('滾轉角變化劇烈'); }
  if (S.bigPitch) { p += 10; n.push('俯仰角變化劇烈'); }
  return p;
}
function laneTrack(c, S) { if (c.fm.onGround) S.lane = Math.max(S.lane || 0, Math.abs(c.fm.pos.x)); }
const laneHint = c => `偏離中心線 ${Math.abs(c.fm.pos.x).toFixed(1)} m（範圍 ±${LINES.lane} m）· 地速 ${(c.spd * 3.6).toFixed(0)} km/h`;
function laneDeduct(S, n) {
  const x = S.lane || 0;
  if (x > LINES.lane) { n.push(`主輪超出 4 m 範圍線（偏 ${x.toFixed(1)} m）`); return x > LINES.lane * 2 ? 40 : 25; }
  return 0;
}
function tdDeduct(S, n) {
  if (S.td.vy > 3) { n.push(`接地過重（${S.td.vy.toFixed(1)} m/s）`); return 25; }
  if (S.td.vy > 1.6) { n.push(`接地稍重（${S.td.vy.toFixed(1)} m/s）`); return 10; }
  n.push('接地輕柔'); return 0;
}

export const PRE_CHECK = ['載具類型與最大起飛總重', '重心位置', '螺旋槳規格與固定', '動力、電池規格與電量', '遙控設備與頻率', '各搖桿、開關功能正確', '控制面方向正確', '機體 360 度外觀檢查'];
export const POST_CHECK = ['關閉動力、解除電源', '機體 360 度外觀檢查', '螺旋槳與控制面無損傷', '電池溫度與狀態'];

export const ITEMS = [
  {
    id: 'taxi', code: 'B', name: '地面滑行及轉彎', setup: { z: zc + 12, heading: 0 }, groundOnly: true,
    brief: '機頭朝頂風（北）。直線滑行通過起飛線後緩速向左 180° 掉頭，順風滑行到另一端，通過起飛線後緩速向右 180° 掉頭，停在起飛線前。主輪不得超出 4 m 範圍線。',
    phases: [
      { text: '口令「3、2、1、Go」→ 向頂風方向直線滑行，通過北端起飛線', check: (c, S) => { laneTrack(c, S); return c.fm.pos.z < zc - zT; }, hint: laneHint },
      { text: '緩速向左做 180° 掉頭，對正跑道中心線', enter: (c, st) => { st.acc = 0; }, check: (c, S, st) => { if (c.spd > 4.5) S.fastTurn = true; return st.acc >= 165; }, hint: (c, S, st) => `已轉 ${Math.max(0, st.acc).toFixed(0)}° / 180°（向左）· 地速 ${(c.spd * 3.6).toFixed(0)} km/h` },
      { text: '順風直線滑行至另一端，通過南端起飛線', enter: (c, st) => { st.t = 0; }, check: (c, S, st) => { st.t += c.dt; if (st.t > 2.5) laneTrack(c, S); return c.fm.pos.z > zc + zT; }, hint: laneHint },
      { text: '緩速向右做 180° 掉頭', enter: (c, st) => { st.acc = 0; }, check: (c, S, st) => { if (c.spd > 4.5) S.fastTurn = true; return st.acc <= -165; }, hint: (c, S, st) => `已轉 ${Math.max(0, -st.acc).toFixed(0)}° / 180°（向右）` },
      { text: '停在起飛線之前（不得越線），口誦「結束」', check: (c, S) => { if (c.fm.pos.z < zc + zT) S.overLine = true; return c.spd < 0.3 && c.inp.thr < 0.05; } },
    ],
    score(S) {
      const n = []; let s = 100 - laneDeduct(S, n);
      if (S.fastTurn) { s -= 15; n.push('掉頭速度過快'); }
      if (S.overLine) { s -= 25; n.push('停止時越過起飛線'); }
      if (!n.length) n.push('滑行穩定、對正中心線');
      return [s, n];
    },
  },
  {
    id: 'takeoff', code: 'C', name: '起飛航線', setup: { z: zc + zT + 4, heading: 0 },
    brief: '油門加到大車（100%）直線滑跑，主輪不超出 4 m 範圍線，頂風緩慢離地，依左航線爬升，進入第三邊後結束。',
    phases: [
      { text: '口令 → 油門推到 100%（大車），沿中心線直線滑跑', check: (c, S) => { laneTrack(c, S); if (c.fm.onGround && c.spd > 3) S.thrMin = Math.min(S.thrMin ?? 1, c.inp.thr); return !c.fm.onGround && c.alt > 1; }, hint: laneHint },
      { text: '緩慢離地爬升（第一邊），俯仰角不可劇烈變化', check: (c, S) => { trackSmooth(c, S); return c.fm.pos.z < PAT.zN + 20; }, hint: c => `高度 ${c.alt.toFixed(0)} m · 俯仰 ${c.pitch.toFixed(0)}°` },
      { text: '第二邊：左轉 90° 往前方（西）飛', check: (c, S) => { trackSmooth(c, S); return c.fm.pos.x < PAT.xFar + 20; }, hint: c => `高度 ${c.alt.toFixed(0)} m` },
      { text: '左轉進入第三邊（順風邊），口誦「結束」', check: (c, S) => { trackSmooth(c, S); return c.fm.vel.z > 4 && c.fm.pos.x < -60; }, hint: c => `高度 ${c.alt.toFixed(0)} m` },
    ],
    score(S) {
      const n = []; let s = 100 - laneDeduct(S, n) - smoothDeduct(S, n);
      if ((S.thrMin ?? 1) < 0.9) { s -= 10; n.push('滑跑時未維持大車油門'); }
      if (!n.length) n.push('頂風起飛、對正中心線、爬升平順');
      return [s, n];
    },
  },
  {
    id: 'pattern', code: 'D', name: '高度保持五邊飛行', setup: null,
    practice: { air: true, x: PAT.xFar, y: 30, z: -60, heading: Math.PI, thr: 0.55 },
    brief: '接續起飛，維持穩定航高飛完整一圈五邊航線。轉向時準確操作副翼與升降舵，第一邊與第五邊須穩定準確通過跑道正前方。',
    phases: [
      { text: '第三邊：平行跑道往南飛，保持航高', check: (c, S) => { S.tracking = true; trackSmooth(c, S); return c.fm.pos.z > PAT.zS - 20; } },
      { text: '第四邊：左轉 90° 飛向跑道延長線', check: (c, S) => { trackSmooth(c, S); return c.fm.pos.x > -30; } },
      { text: '第五邊：左轉對正跑道，穩定通過飛手正前方', check: (c, S) => { trackSmooth(c, S); if (Math.abs(c.fm.pos.z - zc) < 6) S.pass5 = Math.abs(c.fm.pos.x); return c.fm.pos.z < zc - 10; } },
      { text: '第一邊：保持直線，飛過北端', check: (c, S) => { trackSmooth(c, S); return c.fm.pos.z < PAT.zN + 20; } },
      { text: '第二邊：左轉 90° 往前方（西）飛', check: (c, S) => { trackSmooth(c, S); return c.fm.pos.x < PAT.xFar + 20; } },
      { text: '左轉回到第三邊，完成一圈，口誦「結束」', check: (c, S) => { trackSmooth(c, S); return c.fm.vel.z > 4 && c.fm.pos.x < -60 && c.fm.pos.z > PAT.zN + 40; } },
    ],
    score(S) {
      const n = []; let s = 100 - altDeduct(S, n) - smoothDeduct(S, n);
      if ((S.pass5 ?? 99) > 15) { s -= 15; n.push('第五邊未準確通過跑道正前方'); }
      if (!n.length) n.push(PRACTICE ? '五邊完整、轉彎平順' : '航高穩定、五邊完整');
      return [s, n];
    },
  },
  {
    id: 'eight', code: 'D', name: '水平 8 字', setup: null,
    practice: { air: true, x: PILOT.x - 25, y: 30, z: PILOT.z, heading: Math.PI / 2, thr: 0.55 },
    brief: '由 P1–P4 任一點進入，交叉點 P5 在飛手正前方約 50 m（地圖上的 ✚）。先轉一圈再反方向轉一圈，全程保持高度，不可通過飛手頭頂上方。',
    phases: [
      { text: '飛向交叉點 P5（飛手正前方 50 m），保持高度', check: (c, S) => { if (d8(c.fm.pos) < 22) { S.tracking = true; return true; } } },
      {
        text: '第一個圓：轉一整圈（左右皆可），回到 P5',
        enter: (c, st) => { Object.assign(st, { acc: 0, maxD: 0, cx: 0, cz: 0, n: 0 }); },
        check: (c, S, st) => {
          const p = c.fm.pos; st.maxD = Math.max(st.maxD, d8(p)); st.cx += p.x; st.cz += p.z; st.n++;
          if (Math.abs(st.acc) >= 320 && d8(p) < 40) { S.dir = Math.sign(st.acc); S.r1 = st.maxD / 2; S.c1 = [st.cx / st.n, st.cz / st.n]; return true; }
        },
        hint: (c, S, st) => `已轉 ${Math.abs(st.acc).toFixed(0)}° / 360° · ${altHint(c, S)}`,
      },
      {
        text: '第二個圓：反方向轉一整圈，回到 P5，口誦「結束」',
        enter: (c, st) => { Object.assign(st, { acc: 0, maxD: 0, cx: 0, cz: 0, n: 0 }); },
        check: (c, S, st) => {
          const p = c.fm.pos; st.maxD = Math.max(st.maxD, d8(p)); st.cx += p.x; st.cz += p.z; st.n++;
          if (st.acc * S.dir <= -320 && d8(p) < 40) { S.r2 = st.maxD / 2; S.c2 = [st.cx / st.n, st.cz / st.n]; return true; }
        },
        hint: (c, S, st) => `反方向已轉 ${Math.max(0, -st.acc * S.dir).toFixed(0)}° / 360° · ${altHint(c, S)}`,
      },
    ],
    fail: (c, S, i, st) => (i === 2 && st.acc * S.dir > 200 ? '第二圈要往反方向轉' : null),
    score(S) {
      const n = []; let s = 100 - altDeduct(S, n);
      for (const [r, k] of [[S.r1, '第一圈'], [S.r2, '第二圈']]) {
        if (r < 15) { s -= 15; n.push(`${k}太小`); }
        if (r > 90) { s -= 15; n.push(`${k}太大`); }
      }
      if (Math.abs(S.r1 - S.r2) / Math.max(S.r1, S.r2) > 0.35) { s -= 15; n.push('兩圈大小不對稱'); }
      if (Math.hypot(S.c1[0] - S.c2[0], S.c1[1] - S.c2[1]) < 0.4 * (S.r1 + S.r2)) { s -= 20; n.push('兩圈重疊，未分在 P5 兩側'); }
      if (!n.length) n.push(PRACTICE ? '兩圈對稱' : '兩圈對稱、高度穩定');
      return [s, n];
    },
  },
  {
    id: 'landing', code: 'E', name: '降落航線及落地', setup: null,
    practice: { air: true, x: PAT.xFar, y: 28, z: -100, heading: Math.PI, thr: 0.5 },
    brief: '維持五邊正常航線降落，等速飄降，降落點不得超越中線。無法順利進場可重飛一次（飛過中線北方即視為重飛）。落地後滑行掉頭停止。',
    phases: [
      { text: '口令 → 加入第三邊（順風邊），準備降落', check: c => c.fm.vel.z > 3 && c.fm.pos.x < -60 && c.fm.pos.z > PAT.zN + 40 },
      { text: '第四邊：左轉，收小油門開始下降', check: c => c.fm.pos.x > -35 && c.fm.pos.z > zc + 40 },
      { text: '第五邊：對正跑道等速飄降，在中線之前接地', check: (c, S) => S.landed, hint: c => `高度 ${c.alt.toFixed(1)} m · 下降率 ${Math.max(0, -c.fm.vel.y).toFixed(1)} m/s · 距中線 ${(c.fm.pos.z - zc).toFixed(0)} m` },
      { text: '落地後減速，滑行轉彎掉頭', enter: (c, st) => { st.acc = 0; }, check: (c, S, st) => Math.abs(st.acc) >= 150, hint: (c, S, st) => `已轉 ${Math.abs(st.acc).toFixed(0)}° / 180°` },
      { text: '停止，口誦「結束」', check: c => c.spd < 0.3 && c.inp.thr < 0.05 },
    ],
    onEvent(c, S, ev) {
      if (ev.type === 'landing' && !S.landed) { S.landed = true; S.td = { vy: ev.vy, x: c.fm.pos.x, z: c.fm.pos.z, on: ON_RUNWAY(c.fm.pos) }; }
    },
    goAround(c, S, i) {
      if (i === 2 && !S.landed && !c.fm.onGround && c.fm.pos.z < zc - 40) { S.ga = (S.ga || 0) + 1; return S.ga > 1 ? 'fail' : 0; }
      return null;
    },
    fail: (c, S, i) => (c.fm.onGround && i < 2 ? '未依五邊航線完成就接地' : null),
    score(S) {
      const n = [];
      if (!S.td.on) return [30, ['未降落在跑道上']];
      let s = 100 - tdDeduct(S, n);
      if (S.td.z < zc) { s -= 35; n.push('降落點超越中線'); }
      if (Math.abs(S.td.x) > LINES.lane) { s -= 10; n.push('接地偏離中心線'); }
      if (S.ga) n.push('重飛 1 次');
      return [s, n];
    },
  },
  {
    id: 'emergency', code: 'F', name: '緊急程序處置', setup: { z: zc + zT + 4, heading: 0 },
    brief: '第二次起飛後維持五邊航線。監評在空中任一位置下達指示時，口誦「開始迫降」並立即把油門收到怠速（15% 以下），自行判斷高度、距離與進場航線，安全返場降落於跑道上。',
    phases: [
      { text: '第二次起飛：沿中心線起飛，加入五邊航線並保持航高', check: (c, S) => { laneTrack(c, S); if (!c.fm.onGround === false && c.alt > (PRACTICE ? 8 : BAND[0]) && c.fm.pos.z < PAT.zN + 60) { S.wait = 4 + Math.random() * 14; S.tracking = true; return true; } } },
      { text: '保持五邊航線，等待監評指示…', check: (c, S) => { S.wait -= c.dt; return S.wait <= 0; } },
      { text: '⚠️ 監評：「開始迫降」！立即把油門收到怠速（15% 以下）', enter: (c, st) => { st.t = 0; }, check: (c, S, st) => { st.t += c.dt; S.tracking = false; if (c.inp.thr <= 0.15) { S.react = st.t; S.idle = true; return true; } if (st.t > 3) S.slow = true; }, hint: c => `油門 ${Math.round(c.inp.thr * 100)}%` },
      { text: '怠速滑翔：判斷高度、距離與進場航線，返場降落於跑道上', check: (c, S) => { if (c.inp.thr > 0.2) S.addThr = true; return S.landed; }, hint: c => `高度 ${c.alt.toFixed(0)} m · 空速 ${(c.fm.airspeed * 3.6).toFixed(0)} km/h · 油門 ${Math.round(c.inp.thr * 100)}%` },
      { text: '減速停止，口誦「結束」', check: c => c.spd < 0.3 },
    ],
    onEvent(c, S, ev) { if (ev.type === 'landing' && S.idle && !S.landed) { S.landed = true; S.td = { vy: ev.vy, on: ON_RUNWAY(c.fm.pos) }; } },
    fail: (c, S, i) => {
      if (i === 2 && S.slow) return '未立即將油門收至怠速';
      if (c.fm.onGround && i === 1) return '尚未下達迫降指示就接地';
      return null;
    },
    score(S) {
      const n = [];
      if (!S.td.on) return [30, ['未返場降落於跑道上']];
      let s = 100 - tdDeduct(S, n);
      n.push(`收油門反應 ${S.react.toFixed(1)} 秒`);
      if (S.react > 1.5) s -= 10;
      if (S.addThr) { s -= 30; n.push('迫降過程中加油門'); }
      return [s, n];
    },
  },
];

export class Examiner {
  constructor(ui) { this.ui = ui; this.active = false; }
  get groundOnly() { return this.active && !!(ITEMS[this.item] && ITEMS[this.item].groundOnly); }

  // single：練習模式只考單一科目（傳入科目索引）
  start(single = null) { this.single = single; PRACTICE = single !== null; this.active = true; this.finished = false; this.results = []; this.item = single ?? 0; this.beginItem(); }
  beginItem() {
    const it = ITEMS[this.item];
    this.S = {}; this.phase = 0; this.t = 0; this.prevYaw = null;
    this.ui.setup(it, this.item, this.single !== null ? (it.practice || it.setup) : it.setup);
    this.enterPhase();
  }
  enterPhase() { this.st = {}; this.pending = true; this.ui.phase(this.item, ITEMS[this.item], this.phase); }

  update(dt, fm, inp) {
    if (!this.active || this.finished || fm.crashed) return;
    const it = ITEMS[this.item];
    const e = fm.euler(), yaw = e.y * D;
    if (this.prevYaw === null) this.prevYaw = yaw;
    const dy = wrapDeg(yaw - this.prevYaw);
    this.prevYaw = yaw;
    this.t += dt;
    const c = { fm, inp, dt, t: this.t, pitch: e.x * D, roll: e.z * D, spd: Math.hypot(fm.vel.x, fm.vel.z), alt: fm.pos.y - fm.h(fm.pos.x, fm.pos.z) - fm.gearH };
    this.ctx = c;
    // 重大違失
    if (!fm.onGround && fm.pos.x > PILOT.x + 5) return this.endItem(false, '重大違失：飛機超越應考人後方', true);
    if (!fm.onGround && c.alt > 2 && Math.hypot(fm.pos.x - PILOT.x, fm.pos.z - PILOT.z) < 12) return this.endItem(false, '重大違失：通過應考人頭頂上方', true);
    const ph = it.phases[this.phase];
    if (this.pending) { ph.enter && ph.enter(c, this.st); this.pending = false; }
    if (this.st.acc !== undefined) this.st.acc += dy;
    trackAlt(c, this.S);
    if (PRACTICE && (this.S.vis || 0) > 10) return this.endItem(false, '飛機超出目視範圍太久');
    if (this.t > 360) return this.endItem(false, '超過時間限制');
    if (it.goAround) {
      const g = it.goAround(c, this.S, this.phase);
      if (g === 'fail') return this.endItem(false, '重飛超過 1 次');
      if (g === 0) { this.ui.toast('重飛降落程序', '重新加入五邊航線（僅允許 1 次）'); this.phase = 0; return this.enterPhase(); }
    }
    const f = it.fail && it.fail(c, this.S, this.phase, this.st);
    if (f) return this.endItem(false, f);
    this.ui.hint(ph.hint ? ph.hint(c, this.S, this.st) : altHint(c, this.S));
    if (ph.check(c, this.S, this.st)) {
      this.phase++;
      if (this.phase >= it.phases.length) this.endItem(true);
      else this.enterPhase();
    }
  }

  event(fm, ev) {
    if (!this.active || this.finished || !this.ctx) return;
    if (ev.type === 'crash') return this.endItem(false, '重大違失：墜機（' + ev.text + '）', true);
    const it = ITEMS[this.item];
    it.onEvent && it.onEvent(this.ctx, this.S, ev);
  }

  endItem(ok, reason, fatal = false) {
    const it = ITEMS[this.item];
    let score = 0, notes = [reason];
    if (ok) { [score, notes] = it.score(this.S); score = Math.max(0, Math.round(score)); }
    const pass = ok && score >= 70;
    this.results.push({ code: it.code, name: it.name, score, pass, notes });
    this.ui.itemDone(this.item, it, score, pass, notes);
    this.item++;
    if (this.single !== null) { this.finished = true; this.active = false; this.ui.report(this.results, fatal, true); return; }
    if (fatal || this.item >= ITEMS.length) {
      this.finished = true; this.active = false;
      for (let i = this.item; i < ITEMS.length; i++) this.results.push({ code: ITEMS[i].code, name: ITEMS[i].name, score: null, pass: false, notes: ['未測驗'] });
      this.ui.report(this.results, fatal);
    } else this.beginItem();
  }
  stop() { this.active = false; this.finished = true; }
}
