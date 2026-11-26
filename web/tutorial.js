// 新手教學：四個操作桿 + 降落要領
// 每一課：setup（起始狀態）、intro（說明）、steps（逐步任務）
// hl：[操作, 方向]，方向 up/down/left/right 指的是「搖桿要往哪裡撥」

const D = 180 / Math.PI;
const hold = (c, cond, sec) => { c.st.h = cond ? (c.st.h || 0) + c.dt : 0; return c.st.h >= sec; };
const ON_RUNWAY = p => Math.abs(p.x) < 8 && Math.abs(p.z) < 72;

export const LESSONS = [
  {
    id: 'thr', name: '油門', icon: '⚡', desc: '控制馬達推力，學會加速、減速與微調',
    setup: { ground: true }, groundOnly: true,
    intro: '油門控制馬達轉速，也就是推力大小。它在 {thr}：往上推加速、往下拉減速。\n\n和其他三個舵不同，油門放手後會停在原位，不會自動回中。',
    steps: [
      { text: '把油門往上推到 80% 以上', hl: [['thr', 'up']], check: c => c.inp.thr > 0.8 },
      { text: '飛機開始滑跑了！把油門拉到底（0%）', hl: [['thr', 'down']], check: c => c.inp.thr < 0.05 },
      { text: '保持油門 0，等飛機完全停下來', check: c => hold(c, c.inp.thr < 0.05 && c.spd < 0.5, 0.5) },
      { text: '練習微調：把油門停在 20–40% 之間，保持 2 秒', hl: [['thr', 'up']], check: c => hold(c, c.inp.thr > 0.2 && c.inp.thr < 0.4, 2), hint: c => `目前 ${Math.round(c.inp.thr * 100)}%` },
      { text: '收回油門，讓飛機停下', hl: [['thr', 'down']], check: c => c.inp.thr < 0.05 && c.spd < 0.5 },
    ],
  },
  {
    id: 'rud', name: '方向舵', icon: '↔️', desc: '控制機頭左右轉向，地面滑行轉彎',
    setup: { ground: true }, groundOnly: true,
    intro: '方向舵（Rudder）讓機頭左右轉向（偏航）。它在 {rud}。\n\n地面滑行時，方向舵會帶動前輪轉彎；在空中則用來修正機頭方向、讓轉彎更協調。',
    steps: [
      { text: '先給一點油門（20% 以上），讓飛機開始滑行', hl: [['thr', 'up']], check: c => c.inp.thr > 0.18 && c.spd > 1.5 },
      { text: '往左打方向舵，讓機頭向左轉 45°', hl: [['rud', 'left']], enter: c => { c.st.acc = 0; }, check: c => c.st.acc >= 40, hint: c => `已轉 ${Math.max(0, c.st.acc).toFixed(0)}° / 45°` },
      { text: '往右打方向舵，讓機頭向右轉 90°', hl: [['rud', 'right']], enter: c => { c.st.acc = 0; }, check: c => c.st.acc <= -80, hint: c => `已轉 ${Math.max(0, -c.st.acc).toFixed(0)}° / 90°` },
      { text: '方向舵回中、油門收到 0，讓飛機停下', hl: [['thr', 'down']], check: c => c.inp.thr < 0.05 && c.spd < 0.5 },
    ],
  },
  {
    id: 'ele', name: '升降舵', icon: '↕️', desc: '控制機頭上下，爬升與下降',
    setup: { air: true, x: 0, y: 60, z: 150, heading: 0, thr: 0.5 },
    intro: '升降舵（Elevator）控制機頭上下（俯仰）。它在 {ele}。\n\n⚠️ 跟直覺相反：往下拉是機頭抬起（爬升），往上推是機頭壓低（下降）。所有真實遙控器都是這樣。\n\n動作要輕，一點點就夠了。',
    steps: [
      { text: '輕輕往下拉升降舵，爬升 10 公尺', hl: [['ele', 'down']], enter: c => { c.st.y0 = c.fm.pos.y; }, check: c => c.fm.pos.y >= c.st.y0 + 10, hint: c => `已爬升 ${Math.max(0, c.fm.pos.y - c.st.y0).toFixed(1)} m` },
      { text: '輕輕往上推升降舵，下降 10 公尺', hl: [['ele', 'up']], enter: c => { c.st.y0 = c.fm.pos.y; }, check: c => c.fm.pos.y <= c.st.y0 - 10, hint: c => `已下降 ${Math.max(0, c.st.y0 - c.fm.pos.y).toFixed(1)} m` },
      { text: '升降舵回中，讓飛機保持平飛 3 秒', check: c => hold(c, Math.abs(c.fm.vel.y) < 1.2 && Math.abs(c.pitch) < 10, 3), hint: c => `垂直速度 ${c.fm.vel.y.toFixed(1)} m/s` },
    ],
  },
  {
    id: 'ail', name: '副翼', icon: '🔄', desc: '控制左右傾斜，壓坡度與轉彎',
    setup: { air: true, x: 0, y: 60, z: 150, heading: 0, thr: 0.5 },
    intro: '副翼（Aileron）控制飛機左右傾斜（滾轉）。它在 {ail}。\n\n飛機傾斜後升力也跟著傾斜，就會轉彎。「水平自穩模式」下，搖桿壓多少就傾斜多少、放開會自動改平；「全手動模式」下放開會維持坡度，要主動往反方向壓回來改平。轉彎時要持續壓住副翼。右上角的「自穩／手動」按鈕可以切換。',
    steps: [
      { text: '往右壓副翼，讓飛機向右傾斜 30°', hl: [['ail', 'right']], check: c => -c.roll >= 25, hint: c => `坡度 ${Math.abs(c.roll).toFixed(0)}°` },
      { text: '往左壓一點，把機翼改平（10° 以內）並維持 1 秒', hl: [['ail', 'left']], check: c => hold(c, Math.abs(c.roll) < 10, 1), hint: c => `坡度 ${Math.abs(c.roll).toFixed(0)}°` },
      { text: '往左壓副翼，讓飛機向左傾斜 30°', hl: [['ail', 'left']], check: c => c.roll >= 25, hint: c => `坡度 ${Math.abs(c.roll).toFixed(0)}°` },
      { text: '往右壓一點，把機翼改平並維持 1 秒', hl: [['ail', 'right']], check: c => hold(c, Math.abs(c.roll) < 10, 1), hint: c => `坡度 ${Math.abs(c.roll).toFixed(0)}°` },
      { text: '轉彎 = 副翼壓坡度 + 輕拉升降舵。做一個 180° 迴轉飛回機場', hl: [['ail', 'left'], ['ele', 'down']], enter: c => { c.st.acc = 0; }, check: c => Math.abs(c.st.acc) >= 170, hint: c => `已轉 ${Math.abs(c.st.acc).toFixed(0)}° / 180°` },
      { text: '把機翼改平，維持 1 秒', check: c => hold(c, Math.abs(c.roll) < 10, 1) },
    ],
  },
  {
    id: 'land', name: '降落', icon: '🛬', desc: '進場、下降、拉平、接地',
    setup: { air: true, x: 0, y: 20, z: 230, heading: 0, thr: 0.25 },
    intro: '降落要領：\n① 對準跑道，用副翼保持機翼水平\n② 油門收小（0–10%），讓飛機緩慢下降\n③ 高度剩 2–3 公尺時油門收到 0，慢慢往下拉升降舵讓機頭微抬（拉平），減慢下降速度\n④ 輕輕接地後保持直線滑行停下\n\n飛機正逆風進場，跑道就在正前方。',
    steps: [
      { text: '把油門收到 0–10%，讓飛機開始下降', hl: [['thr', 'down']], check: c => hold(c, c.inp.thr < 0.12, 0.5), hint: c => `油門 ${Math.round(c.inp.thr * 100)}%` },
      { text: '保持機翼水平、對準跑道，持續下降', hl: [['ail', 'left'], ['ail', 'right']], check: c => c.fm.pos.z < 105, hint: c => `高度 ${c.alt.toFixed(1)} m` },
      { text: '高度 2–3 公尺時油門收 0，慢慢往下拉升降舵拉平，輕輕接地', hl: [['ele', 'down']], check: c => c.st.landed, hint: c => `高度 ${c.alt.toFixed(1)} m · 下降率 ${Math.max(0, -c.fm.vel.y).toFixed(1)} m/s` },
      { text: '漂亮！油門保持 0，直線滑行到停止', check: c => c.spd < 0.8 && c.fm.onGround },
    ],
    onEvent(c, ev) {
      if (ev.type !== 'landing') return;
      if (!ON_RUNWAY(c.fm.pos)) return '沒有降落在跑道上';
      c.st.landed = true;
    },
    fail(c) {
      if (!c.fm.onGround && c.fm.pos.z < -110) return '飛過頭了，重新進場';
      if (c.fm.onGround && !c.st.landed && c.stepIdx < 2) return '太早接地了';
      return null;
    },
  },
];

export class Tutor {
  constructor(ui) { this.ui = ui; this.lesson = null; }

  start(lesson) {
    this.lesson = lesson; this.idx = 0; this.done = false; this.failMsg = null;
    this.prevYaw = null;
    this.enter();
  }
  enter() {
    this.st = {};
    const s = this.lesson.steps[this.idx];
    this.ctx = null;
    this.pendingEnter = s.enter || null;
    this.ui.step(this.lesson, this.idx, s);
  }

  update(dt, fm, inp) {
    if (!this.lesson || this.done || fm.crashed) return;
    const e = fm.euler();
    const yaw = e.y * D;
    if (this.prevYaw === null) this.prevYaw = yaw;
    let dy = yaw - this.prevYaw; if (dy > 180) dy -= 360; if (dy < -180) dy += 360;
    this.prevYaw = yaw;
    const c = {
      fm, inp, dt, st: this.st, stepIdx: this.idx,
      pitch: e.x * D, roll: e.z * D, yaw,
      spd: Math.hypot(fm.vel.x, fm.vel.z),
      alt: fm.pos.y - fm.h(fm.pos.x, fm.pos.z) - fm.gearH,
    };
    if (this.pendingEnter) { this.pendingEnter(c); this.pendingEnter = null; }
    if (this.st.acc !== undefined) this.st.acc += dy;
    this.ctx = c;
    const L = this.lesson;
    const f = L.fail && L.fail(c);
    if (f) return this.fail(f);
    const s = L.steps[this.idx];
    if (s.hint) this.ui.hint(s.hint(c));
    if (s.check(c)) {
      this.idx++;
      if (this.idx >= L.steps.length) { this.done = true; this.ui.complete(L); }
      else { this.ui.good(); this.enter(); }
    }
  }

  event(fm, ev) {
    if (!this.lesson || this.done || !this.lesson.onEvent || !this.ctx) return;
    const r = this.lesson.onEvent(this.ctx, ev);
    if (r) this.fail(r);
  }

  fail(msg) { if (this.done) return; this.done = true; this.ui.fail(msg); }
  stop() { this.lesson = null; }
}
