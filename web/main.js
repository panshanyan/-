import * as THREE from 'three';
import { FlightModel, PLANES } from './physics.js';
import { terrainHeight } from './terrain.js';
import { buildWorld, PILOT, SUN_DIR } from './world.js';
import { buildPlane } from './model.js';
import { PAINTS } from './trainer.js';
import { LESSONS, Tutor } from './tutorial.js';
import { ITEMS, Examiner, PAT, C8, BAND, PRE_CHECK, POST_CHECK, isPractice, phaseText } from './exam.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 設定 ----------
const DEF = { assist: true, as: { stall: true, coord: true, roll: true, reverse: false, marker: true }, site: 'zhutian', paint: 'yellow', plane: 'trainer', mode: 2, rate: 80, expo: 30, wind: 2, gust: 30, qual: 1, vol: 50, cam: 1, pip: 1,
  pad: false, map: { ail: [0, false], ele: [1, true], thr: [2, true], rud: [3, false], mode: [-1, false] }, fmode: 'stab' };
let cfg;
try { cfg = Object.assign({}, DEF, JSON.parse(localStorage.getItem('rcsim') || '{}')); } catch (e) { cfg = { ...DEF }; }
cfg.map = Object.assign({}, DEF.map, cfg.map);
cfg.as = Object.assign({}, DEF.as, cfg.as);
const save = () => { try { localStorage.setItem('rcsim', JSON.stringify(cfg)); } catch (e) {} };

// ---------- 渲染 ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: cfg.qual > 0, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.qual > 0 ? 2 : 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (cfg.qual > 0) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
const world = buildWorld(scene, renderer, cfg.qual, cfg.site);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  layoutSticks();
  layoutPip();
}
window.addEventListener('resize', resize);

// ---------- 飛機 ----------
let fm, mdl;
const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

function loadPlane(key) {
  if (mdl) scene.remove(mdl.group);
  const spec = PLANES[key];
  fm = new FlightModel(spec, terrainHeight);
  mdl = buildPlane(spec, cfg.paint);
  scene.add(mdl.group);
  applyWind();
  resetPlane(false);
}

function applyWind() {
  const a = Math.PI / 2; // 風從北方吹來（往 +Z），沿跑道逆風起降
  fm.wind.set(Math.cos(a) * cfg.wind, 0, Math.sin(a) * cfg.wind);
  fm.gust = cfg.gust / 100;
}

// 起飛方向：逆風起飛
function resetPlane(air, o = {}) {
  clearDebris();
  const heading = o.heading || 0;
  fm.reset(o.x ?? 0, o.z ?? 50, heading);
  if (air) {
    fm.pos.set(o.x ?? 0, o.y ?? 45, o.z ?? 60);
    fm.vel.set(0, 0, -1).applyQuaternion(fm.q).multiplyScalar(fm.spec.vref * 1.2);
    fm.onGround = false;
    fm.airTime = 5;
    setThrottleStick(o.thr ?? 0.5);
  } else {
    setThrottleStick(0);
  }
  mdl.group.visible = true;
  smoke.reset();
  toastTimer = 0; $('toast').style.opacity = 0;
  camState.init = pipState.init = false;
  maxDist = 0;
}

// ---------- 墜機碎片 ----------
const debris = [];
function explode() {
  mdl.group.updateMatrixWorld(true);
  const meshes = [];
  mdl.group.traverse(o => { if (o.isMesh && o.material.opacity !== 0) meshes.push(o); });
  for (const o of meshes) {
    const m = o.clone();
    o.getWorldPosition(m.position);
    o.getWorldQuaternion(m.quaternion);
    o.getWorldScale(m.scale);
    const v = lastVel.clone().multiplyScalar(0.35).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6));
    m.userData = { v, w: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5) };
    scene.add(m);
    debris.push(m);
  }
  mdl.group.visible = false;
  // 塵土
  for (let i = 0; i < 18; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.12, 6, 4), new THREE.MeshLambertMaterial({ color: 0x8d7b62, transparent: true, opacity: 0.6, depthWrite: false }));
    p.position.copy(fm.pos);
    p.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5), w: new THREE.Vector3(), dust: 1 };
    scene.add(p); debris.push(p);
  }
}
function clearDebris() { for (const d of debris) scene.remove(d); debris.length = 0; }
function updateDebris(dt) {
  for (const d of debris) {
    const u = d.userData;
    if (u.dust) { u.v.multiplyScalar(Math.exp(-2 * dt)); u.v.y -= 0.5 * dt; d.scale.multiplyScalar(1 + dt * 0.8); d.material.opacity = Math.max(0, d.material.opacity - dt * 0.25); }
    else u.v.y -= 9.81 * dt;
    d.position.addScaledVector(u.v, dt);
    const gh = terrainHeight(d.position.x, d.position.z) + 0.03;
    if (d.position.y < gh) { d.position.y = gh; u.v.y *= -0.3; u.v.x *= 0.6; u.v.z *= 0.6; u.w.multiplyScalar(0.5); }
    d.rotation.x += u.w.x * dt; d.rotation.y += u.w.y * dt; d.rotation.z += u.w.z * dt;
  }
}

// ---------- 拉煙 ----------
const smoke = (() => {
  const N = 900;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), age = new Float32Array(N).fill(99);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('age', new THREE.BufferAttribute(age, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { scale: { value: 600 } },
    vertexShader: 'attribute float age; uniform float scale; varying float a; void main(){ a = age; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = (0.35+age*0.45)*scale/(-mv.z); }',
    fragmentShader: 'varying float a; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor = vec4(1.,1.,1., (1.-d*2.)*max(0.,1.-a/7.)*0.55); }',
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let i = 0, acc = 0;
  return {
    on: false, mat,
    reset() { age.fill(99); geo.attributes.age.needsUpdate = true; },
    update(dt, p) {
      for (let k = 0; k < N; k++) age[k] += dt;
      if (this.on && p) {
        acc += dt;
        while (acc > 0.02) { acc -= 0.02; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; age[i] = 0; i = (i + 1) % N; }
        geo.attributes.position.needsUpdate = true;
      }
      geo.attributes.age.needsUpdate = true;
    },
  };
})();

// ---------- 輸入 ----------
const input = { thr: 0, ail: 0, ele: 0, rud: 0, thrHold: 0 };
let revOn = false;
// 測驗模式（正式考試）不提供輔助
function assistOn() { return cfg.assist && !(game.mode === 'exam' && game.single === null); }
const sticks = {
  L: { el: $('stickL'), x: 0, y: 0, id: null },
  R: { el: $('stickR'), x: 0, y: 0, id: null },
};
// y：+1 = 往上推
function throttleStick() { return cfg.mode === 2 ? 'L' : 'R'; }
function setThrottleStick(t) { sticks.L.y = sticks.R.y = 0; sticks[throttleStick()].y = t * 2 - 1; input.thrHold = t; }

function layoutSticks() {
  const h = window.innerHeight, size = clamp(Math.min(h * 0.38, window.innerWidth * 0.22), 110, 190);
  for (const k of ['L', 'R']) {
    const base = sticks[k].el.querySelector('.base');
    base.style.width = base.style.height = size + 'px';
    base.style.bottom = Math.max(22, h * 0.07) + 'px';
    base.style[k === 'L' ? 'left' : 'right'] = Math.max(26, window.innerWidth * 0.06) + 'px';
    base.style[k === 'L' ? 'right' : 'left'] = '';
    sticks[k].size = size;
  }
  const lbl = cfg.mode === 2 ? ['油門 / 方向', '升降 / 副翼'] : ['升降 / 方向', '油門 / 副翼'];
  sticks.L.el.querySelector('.lbl').textContent = lbl[0];
  sticks.R.el.querySelector('.lbl').textContent = lbl[1];
}

for (const k of ['L', 'R']) {
  const s = sticks[k];
  s.el.addEventListener('touchstart', e => {
    e.preventDefault();
    audioStart();
    const t = e.changedTouches[0];
    s.id = t.identifier;
    s.ox = t.clientX; s.oy = t.clientY;
    s.sx = s.x; s.sy = throttleStick() === k ? s.y : 0;
  }, { passive: false });
  s.el.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== s.id) continue;
      const r = s.size * 0.5;
      s.x = clamp((t.clientX - s.ox) / r, -1, 1);
      s.y = clamp(s.sy - (t.clientY - s.oy) / r, -1, 1);
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== s.id) continue;
      s.id = null; s.x = 0;
      if (throttleStick() !== k) s.y = 0;
    }
  };
  s.el.addEventListener('touchend', end);
  s.el.addEventListener('touchcancel', end);
}
// 滑鼠（桌面測試用）
for (const k of ['L', 'R']) {
  const s = sticks[k];
  s.el.addEventListener('mousedown', e => { s.mouse = true; s.ox = e.clientX; s.oy = e.clientY; s.sx = s.x; s.sy = throttleStick() === k ? s.y : 0; audioStart(); });
  window.addEventListener('mousemove', e => { if (!s.mouse) return; const r = s.size * 0.5; s.x = clamp((e.clientX - s.ox) / r, -1, 1); s.y = clamp(s.sy - (e.clientY - s.oy) / r, -1, 1); });
  window.addEventListener('mouseup', () => { if (!s.mouse) return; s.mouse = false; s.x = 0; if (throttleStick() !== k) s.y = 0; });
}

const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; audioStart(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// 遙控器軸：Android 原生回傳 [X,Y,Z,RX,RY,RZ,THROTTLE,RUDDER,GAS,BRAKE,HAT_X,HAT_Y]
const AXN = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'THR', 'RUD', 'GAS', 'BRK', 'HX', 'HY'];
let padAxes = null, padSeen = 0, padName = '';
window.__rcAxes = (a, name) => { padAxes = a; padSeen = performance.now(); if (name) padName = name; };
function pollWebPad() {
  if (!navigator.getGamepads) return;
  for (const gp of navigator.getGamepads()) {
    if (gp && gp.connected && gp.axes.length >= 2) {
      const a = Array.from(gp.axes); while (a.length < 12) a.push(0);
      window.__rcAxes(a.slice(0, 12), gp.id);
      return;
    }
  }
}

function expo(v) { const e = cfg.expo / 100; return (1 - e) * v + e * v * v * v; }

function readInput() {
  const L = sticks.L, R = sticks.R;
  let thr, ail, ele, rud;
  if (cfg.mode === 2) { thr = (L.y + 1) / 2; rud = L.x; ele = -R.y; ail = R.x; }
  else { thr = (R.y + 1) / 2; rud = L.x; ele = -L.y; ail = R.x; }
  const ts = sticks[throttleStick()];

  // 鍵盤
  if (keys.KeyW) input.thrHold = Math.min(1, input.thrHold + 0.02);
  if (keys.KeyS) input.thrHold = Math.max(0, input.thrHold - 0.02);
  const kb = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const kp = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  const kr = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (keys.KeyW || keys.KeyS) { ts.y = input.thrHold * 2 - 1; thr = input.thrHold; }
  if (kb) ail = kb; if (kp) ele = kp; if (kr) rud = kr;

  // 遙控器
  pollWebPad();
  const padOn = cfg.pad && padAxes && performance.now() - padSeen < 3000;
  if (padOn) {
    const g = f => { const [i, inv] = cfg.map[f]; const v = padAxes[i] || 0; return inv ? -v : v; };
    ail = g('ail'); ele = g('ele'); rud = g('rud'); thr = clamp((g('thr') + 1) / 2, 0, 1);
    // 搖桿畫面同步顯示
    const tL = cfg.mode === 2 ? [rud, thr * 2 - 1] : [rud, -ele];
    const tR = cfg.mode === 2 ? [ail, -ele] : [ail, thr * 2 - 1];
    L.x = tL[0]; L.y = tL[1]; R.x = tR[0]; R.y = tR[1];
  }
  const rate = cfg.rate / 100;
  input.thr = clamp(thr, 0, 1);
  // 飛行模式：遙控器開關（若有設定）優先，否則用畫面上的選擇
  let st = cfg.fmode === 'stab';
  if (padOn && cfg.map.mode[0] >= 0) { const v = padAxes[cfg.map.mode[0]] || 0; st = (cfg.map.mode[1] ? -v : v) > 0; }
  if (st !== input.stab) { input.stab = st; updateModeBtn(); }
  input.rate = cfg.rate / 100;
  // ---- 輔助模式 ----
  const A = assistOn();
  input.assistStall = A && cfg.as.stall;
  input.assistCoord = A && cfg.as.coord;
  if (fm && A) {
    const e = fm.euler();
    // 滑跑時自動保持跑道方向與中心線（沒有主動打方向舵時）
    if (cfg.as.roll && fm.onGround && input.thr > 0.2 && Math.abs(input.rud) < 0.15 && Math.abs(fm.pos.x) < 20 && Math.abs(fm.pos.z) < 75) {
      const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
      const north = Math.abs(wrap(e.y)) < Math.PI / 2;
      const axis = north ? 0 : Math.PI;
      if (Math.abs(wrap(e.y - axis)) < 0.7) {
        const des = axis + Math.max(-0.25, Math.min(0.25, (north ? 1 : -1) * fm.pos.x * 0.06));
        input.rud = clamp(wrap(e.y - des) * 3, -1, 1);
      }
    }
    // 飛機朝自己飛來時，副翼／方向舵左右自動反向（地面目視）
    if (cfg.as.reverse && cfg.cam === 1 && !fm.onGround) {
      const f = new THREE.Vector3(-Math.sin(e.y), 0, -Math.cos(e.y));
      const toP = new THREE.Vector3(PILOT.x - fm.pos.x, 0, PILOT.z - fm.pos.z).normalize();
      const d = f.dot(toP);
      if (d > 0.35) revOn = true; else if (d < 0.15) revOn = false;
    } else revOn = false;
    if (revOn) { input.ail = -input.ail; input.rud = -input.rud; }
  } else revOn = false;
  input.ail = expo(clamp(ail, -1, 1)) * rate;
  input.ele = expo(clamp(ele, -1, 1)) * rate;
  input.rud = expo(clamp(rud, -1, 1)) * rate;
}

function drawSticks() {
  for (const k of ['L', 'R']) {
    const s = sticks[k], knob = s.el.querySelector('.knob');
    const y = s.y;
    knob.style.left = (50 + s.x * 42) + '%';
    knob.style.top = (50 - y * 42) + '%';
  }
}

// ---------- 引擎聲音 ----------
let ac, osc, osc2, gain, filt;
function audioStart() {
  if (ac || cfg.vol === 0) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    osc = ac.createOscillator(); osc.type = 'sawtooth';
    osc2 = ac.createOscillator(); osc2.type = 'square';
    filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
    gain = ac.createGain(); gain.gain.value = 0;
    const g2 = ac.createGain(); g2.gain.value = 0.3;
    osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(gain); gain.connect(ac.destination);
    osc.start(); osc2.start();
  } catch (e) { ac = null; }
}
function updateAudio(dist) {
  if (!ac) return;
  const t = ac.currentTime, thr = fm.crashed ? 0 : input.thr;
  const glider = fm.spec.glider;
  const f = (glider ? 140 : 90) + thr * (glider ? 380 : 260) + fm.airspeed * 2;
  osc.frequency.setTargetAtTime(f, t, 0.08);
  osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
  filt.frequency.setTargetAtTime(500 + thr * 2500, t, 0.1);
  const att = cfg.cam === 1 ? clamp(30 / Math.max(dist, 1), 0.08, 1) : 1;
  gain.gain.setTargetAtTime((0.015 + thr * 0.13) * (cfg.vol / 100) * att * (thr > 0.02 ? 1 : 0.3), t, 0.1);
}

function visScale() { return game.mode === 'exam' ? 1.5 : 1; }
// ---------- 相機 ----------
// cfg.cam：0 = 第三人稱（追尾）、1 = 地面目視、2 = 第一人稱（FPV）
// cfg.pip：地面目視模式下方小視窗 0 = 關、1 = 第三人稱、2 = 第一人稱
const CAMS = ['第三人稱', '地面目視', '第一人稱'];
const PIPS = ['關', '第三人稱', '第一人稱'];
const pipCam = new THREE.PerspectiveCamera(62, 1.6, 0.05, 9000);
const newState = () => ({ init: false, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), look: new THREE.Vector3() });
const camState = newState(), pipState = newState();

function chaseCam(cam, st, dt) {
  const p = fm.pos;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(fm.q);
  if (fm.vel.length() > 3) f.lerp(fm.vel.clone().normalize(), 0.5).normalize();
  if (!st.init) st.fwd.copy(f);
  st.fwd.lerp(f, 1 - Math.exp(-2.5 * dt)).normalize();
  const hz = new THREE.Vector3(st.fwd.x, 0, st.fwd.z);
  if (hz.lengthSq() < 0.01) hz.set(0, 0, -1);
  hz.normalize();
  const pip = cam === pipCam;
  const dist = pip ? fm.spec.span * visScale() * 1.15 : (3.2 + fm.spec.span) * visScale();
  const target = p.clone().addScaledVector(st.fwd, -dist * 0.75).addScaledVector(hz, -dist * 0.35);
  target.y += pip ? dist * 0.28 : 1.0 + fm.spec.span * 0.3;
  if (!st.init || pip) st.pos.copy(target); // 小窗：緊貼機尾，不延遲
  else st.pos.lerp(target, 1 - Math.exp(-6 * dt));
  const gh = terrainHeight(st.pos.x, st.pos.z) + 0.5;
  if (st.pos.y < gh) st.pos.y = gh;
  cam.position.copy(st.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.x, p.y + 0.25, p.z);
  cam.fov = 62;
}
function groundCam(cam, st, dt) {
  const p = fm.pos;
  cam.position.copy(PILOT);
  cam.up.set(0, 1, 0);
  if (!st.init) st.look.copy(p);
  st.look.lerp(p, 1 - Math.exp(-14 * dt));
  cam.lookAt(st.look);
  const d = cam.position.distanceTo(p);
  cam.fov = clamp(2 * Math.atan(4.5 / d) * 180 / Math.PI, 10, 60);
}
function fpvCam(cam) {
  const off = new THREE.Vector3(0, 0.09, -fm.spec.length * 0.3).applyQuaternion(fm.q);
  cam.position.copy(fm.pos).add(off);
  cam.quaternion.copy(fm.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12));
  cam.fov = 95;
}
// 地面目視小窗：鏡頭永遠水平、朝操作者正前方（面向跑道），角度固定不動，只平移跟著飛機
const PILOT_DIR = new THREE.Vector3(-1, 0, 0);
function lockedCam(cam) {
  cam.fov = 40;
  const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
  const d = (fm.spec.span * visScale() / 2) / Math.tan(half) * 1.25;
  cam.up.set(0, 1, 0);
  cam.position.copy(fm.pos).addScaledVector(PILOT_DIR, -d);
  cam.lookAt(fm.pos.x + PILOT_DIR.x, fm.pos.y, fm.pos.z + PILOT_DIR.z);
}
function runCam(mode, cam, st, dt) {
  if (fm.crashed && mode !== 1) { cam.up.set(0, 1, 0); cam.lookAt(fm.pos); }
  else if (mode === 3) lockedCam(cam);
  else if (mode === 0) chaseCam(cam, st, dt);
  else if (mode === 1) groundCam(cam, st, dt);
  else fpvCam(cam);
  st.init = true;
  cam.updateProjectionMatrix();
}
function updateCamera(dt) {
  runCam(cfg.cam, camera, camState, dt);
  // 考照模式的第三人稱小窗改用機身後方追尾視角（搭配航線指示）
  if (pipActive()) runCam(cfg.pip === 1 ? (game.mode === 'exam' ? 0 : 3) : 2, pipCam, pipState, dt);
  if (game.mode === 'exam') updateGuides(dt);
}
const pipActive = () => cfg.cam === 1 && cfg.pip > 0;
function pipRect() {
  const W = window.innerWidth, H = window.innerHeight;
  const k = game.mode === 'exam' ? 0.7 : 1; // 考照模式：小視窗縮為 70%
  const w = Math.round(Math.min(W * 0.34, 340, H * 0.55) * k), h = Math.round(w * 0.62);
  return { x: Math.round((W - w) / 2), y: Math.max(8, Math.round(H * 0.025)), w, h };
}
function layoutPip() {
  const el = $('pip');
  el.style.display = pipActive() ? 'block' : 'none';
  if (!pipActive()) return;
  const r = pipRect();
  Object.assign(el.style, { left: r.x + 'px', bottom: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  el.querySelector('span').textContent = PIPS[cfg.pip] + '視角';
  pipCam.aspect = r.w / r.h;
}
function renderAll() {
  const showPlane = !fm.crashed;
  mdl.group.visible = showPlane && cfg.cam !== 2;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
  if (pipActive()) {
    const r = pipRect();
    $('pip').querySelector('span').textContent = game.mode === 'exam' && cfg.pip === 1 ? '機尾視角 · 航線指示' : PIPS[cfg.pip] + '視角';
    mdl.group.visible = showPlane && cfg.pip !== 2;
    const sc = smoke.mat.uniforms.scale.value;
    smoke.mat.uniforms.scale.value = r.h / (2 * Math.tan(pipCam.fov * Math.PI / 360));
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    renderer.setViewport(r.x, r.y, r.w, r.h);
    renderer.render(scene, pipCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    smoke.mat.uniforms.scale.value = sc;
  }
}
function setCam(m) {
  cfg.cam = m; save();
  $('bCam').textContent = '視角：' + CAMS[m];
  $('bPip').style.display = m === 1 ? '' : 'none';
  $('bPip').textContent = '小窗：' + PIPS[cfg.pip];
  camState.init = pipState.init = false;
  layoutPip();
}

// ---------- 考照航線指示（只畫在小窗：圖層 1）----------
const guides = (() => {
  const G = new THREE.Group(); scene.add(G);
  const ALT = 30;
  // 靠近鏡頭的部分淡出，避免飛在航線上時被管子擋住畫面
  const fadeMat = (color, op) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { c: { value: new THREE.Color(color) }, op: { value: op } },
    vertexShader: 'varying float d; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); d = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float op; varying float d; void main(){ gl_FragColor = vec4(c, op * smoothstep(12., 32., d) * (1. - smoothstep(350., 600., d))); }',
  });
  const tubeM = fadeMat(0x3ff0ff, 0.75), arrowM = fadeMat(0xffffff, 0.9);
  const toLayer = o => o.traverse(c => c.layers.set(1));
  function pathGroup(pts, closed) {
    const grp = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, ALT, z)), closed, 'centripetal');
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.7, 8, closed), tubeM));
    const L = curve.getLength(), n = Math.floor(L / 18), cg = new THREE.ConeGeometry(1.6, 3.4, 3); cg.rotateX(Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const t = i / n, p = curve.getPointAt(t), d = curve.getTangentAt(t);
      const a = new THREE.Mesh(cg, arrowM); a.position.copy(p); a.lookAt(p.clone().sub(d)); grp.add(a);
    }
    toLayer(grp); grp.visible = false; G.add(grp);
    return grp;
  }
  // 左航線矩形（圓角）：第五邊→第一邊往北、第二邊往西、第三邊往南、第四邊往東
  const rc = 30, X = PAT.xFar, N = PAT.zN, Sz = PAT.zS;
  const pattern = pathGroup([[0, Sz - rc], [0, 0], [0, N + rc], [-rc * 0.3, N + rc * 0.3], [-rc, N], [X + rc, N], [X + rc * 0.3, N + rc * 0.3], [X, N + rc], [X, Sz - rc], [X + rc * 0.3, Sz - rc * 0.3], [X + rc, Sz], [-rc, Sz], [-rc * 0.3, Sz - rc * 0.3]], true);
  // 水平 8 字：從 P5 往西進入，先左轉南圈再右轉北圈
  const e8 = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; e8.push([C8.x - C8.r * Math.sin(a), C8.z + C8.r - C8.r * Math.cos(a)]); }
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; e8.push([C8.x - C8.r * Math.sin(a), C8.z - C8.r + C8.r * Math.cos(a)]); }
  const eight = pathGroup(e8, true);
  // 下一個目標點：黃色光圈
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.45, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
  toLayer(ring); G.add(ring);
  pipCam.layers.enable(1);
  return { pattern, eight, ring, ALT, G };
})();
function guideTarget() {
  const it = ITEMS[examiner.item], p = examiner.phase, X = PAT.xFar, N = PAT.zN, Sz = PAT.zS, A = guides.ALT;
  if (!it || !examiner.active) return null;
  const T = {
    takeoff: [null, [0, A, N], [X, A, N], [X, A, 0]],
    pattern: [[X, A, Sz], [0, A, Sz], [0, A, 0], [0, A, N], [X, A, N], [X, A, -40]],
    eight: [[C8.x, A, C8.z], [C8.x, A, C8.z], [C8.x, A, C8.z]],
    landing: [[X, A, -40], [0, A, Sz], [0, 2, 45]],
    emergency: [[0, A, N], null, null, [0, 2, 45]],
  }[it.id];
  return T && T[p] ? T[p] : null;
}
let guideT = 0;
function updateGuides(dt) {
  guideT += dt;
  // 練習模式不指定高度：航線跟著飛機目前高度顯示
  const gy = isPractice() ? Math.max(5, fm.pos.y) - guides.ALT : 0;
  guides.G.position.y += (gy - guides.G.position.y) * Math.min(1, dt * 2);
  const it = examiner.active ? ITEMS[examiner.item] : null;
  const id = it && it.id;
  guides.pattern.visible = ['takeoff', 'pattern', 'landing', 'emergency'].includes(id);
  guides.eight.visible = id === 'eight';
  const t = guideTarget();
  guides.ring.visible = !!t;
  if (t) {
    guides.ring.position.set(t[0], t[1] < 5 ? t[1] - guides.G.position.y : t[1], t[2]);
    const d = new THREE.Vector3(...t).sub(fm.pos); d.y = 0;
    if (d.lengthSq() > 1) guides.ring.lookAt(guides.ring.position.clone().add(d));
    guides.ring.scale.setScalar(1 + 0.12 * Math.sin(guideT * 5));
  }
}

// ---------- 輔助：飛機方向標記 ----------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function updateMarker() {
  const el = $('mark');
  const show = assistOn() && cfg.as.marker && cfg.cam !== 2 && !fm.crashed && !paused;
  if (!show) { el.style.display = 'none'; return; }
  _v1.copy(fm.pos).project(camera);
  if (_v1.z > 1) { el.style.display = 'none'; return; }
  const W = window.innerWidth, H = window.innerHeight;
  const sx = (_v1.x + 1) / 2 * W, sy = (1 - _v1.y) / 2 * H;
  _v2.set(0, 0, -3 * visScale()).applyQuaternion(fm.q).add(fm.pos).project(camera);
  const ang = Math.atan2(-(_v2.y - _v1.y) * H, (_v2.x - _v1.x) * W);
  el.style.display = 'block';
  el.style.left = sx + 'px'; el.style.top = sy + 'px';
  el.querySelector("i").style.transform = `rotate(${ang}rad)`;
  const alt = fm.pos.y - terrainHeight(fm.pos.x, fm.pos.z) - fm.gearH;
  el.querySelector('b').textContent = `${Math.max(0, alt).toFixed(0)} m` + (revOn ? ' · ↔反向' : '');
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(t, p = '', sec = 2.5) {
  $('toastT').textContent = t; $('toastP').textContent = p;
  $('toast').style.opacity = 1; toastTimer = sec;
}
let maxDist = 0, hudT = 0;
function updateHud(dt) {
  hudT += dt;
  if (hudT > 0.1) {
    hudT = 0;
    $('tSpd').textContent = Math.round(fm.airspeed * 3.6);
    $('tAlt').textContent = Math.max(0, fm.pos.y - terrainHeight(fm.pos.x, fm.pos.z) - fm.gearH).toFixed(0);
    $('tThr').textContent = Math.round(input.thr * 100);
    const d = Math.hypot(fm.pos.x - PILOT.x, fm.pos.z - PILOT.z);
    $('tDst').textContent = d.toFixed(0);
  }
  $('warn').style.opacity = fm.stalled && !fm.onGround && !fm.crashed ? 1 : 0;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').style.opacity = 0; }
}

// ---------- 主迴圈 ----------
const lastVel = new THREE.Vector3();
let last = performance.now(), crashTimer = 0, accum = 0;
const STEP = 1 / 120;
const tmp = new THREE.Vector3();

function treeHit() {
  for (const t of world.trees) {
    const dx = fm.pos.x - t.x, dz = fm.pos.z - t.z;
    if (dx * dx + dz * dz < (1.6 * t.s) ** 2 && fm.pos.y < t.y + t.h) return true;
  }
  return false;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) { renderAll(); return; }
  readInput();
  accum += dt;
  while (accum >= STEP) {
    accum -= STEP;
    if (!fm.crashed) lastVel.copy(fm.vel);
    fm.step(STEP, input);
    if (!fm.crashed && !fm.onGround && treeHit()) fm.crash('撞到樹了');
    if (fm.pos.lengthSq() > 2900 * 2900 && !fm.crashed) fm.crash('飛出邊界');
    if (((game.mode === 'tut' && game.lesson.groundOnly) || (game.mode === 'exam' && examiner.groundOnly)) && !fm.crashed) {
      const gy = terrainHeight(fm.pos.x, fm.pos.z) + fm.gearH;
      if (fm.pos.y > gy) { fm.pos.y = gy; if (fm.vel.y > 0) fm.vel.y = 0; }
    }
  }
  if (game.mode === 'tut' && fm.event) tutor.event(fm, fm.event);
  if (game.mode === 'tut') tutor.update(dt, fm, input);
  if (game.mode === 'exam' && fm.event) examiner.event(fm, fm.event);
  if (game.mode === 'exam') { examiner.update(dt, fm, input); drawMini(dt); if (examiner.active && !fm.onGround) examModes.add(!!input.stab); }
  if (fm.event) {
    const ev = fm.event; fm.event = null;
    if (ev.type === 'crash') {
      explode(); if (navigator.vibrate) navigator.vibrate(120);
      if (game.mode === 'tut') { toast('💥 墜機', ev.text, 2); crashTimer = 1.8; }
      else if (game.mode === 'exam') { toast('💥 墜機', ev.text, 2); crashTimer = 0; }
      else { toast('💥 墜機', ev.text + '　·　點「重置」再飛一次', 3.5); crashTimer = 4; }
    }
    else toast(ev.text === '完美降落！' ? '🛬 ' + ev.text : ev.text, '接地速度 ' + (ev.score * 3.6).toFixed(0) + ' km/h', 2.5);
  }
  if (fm.crashed && crashTimer > 0) { crashTimer -= dt; if (crashTimer <= 0) { if (game.mode === 'tut') tutor.fail('墜機了（' + fm.crashInfo + '）'); else resetPlane(false); } }

  // 更新模型
  // 考照模式：飛機外觀放大 1.5 倍（只影響顯示，物理不變），並抬高讓輪子貼地
  const vs = visScale();
  mdl.group.scale.setScalar(vs);
  mdl.group.position.copy(fm.pos).add(tmp.set(0, (vs - 1) * fm.gearH, 0).applyQuaternion(fm.q));
  mdl.group.quaternion.copy(fm.q);
  mdl.update(input, fm.crashed ? 0 : input.thr * (fm.spec.glider ? 70 : 90) + (input.thr > 0.02 ? 15 : 0), dt);

  // 地面陰影
  const gh = terrainHeight(fm.pos.x, fm.pos.z);
  const hAbove = fm.pos.y - gh;
  blob.visible = !fm.crashed && hAbove < 60 && cfg.qual === 0;
  // 陰影相機跟著飛機
  world.sun.target.position.copy(fm.pos);
  world.sun.position.copy(fm.pos).addScaledVector(SUN_DIR, 300);
  blob.position.set(fm.pos.x, gh + 0.05, fm.pos.z);
  const sc = fm.spec.span * 0.45 * (1 + hAbove * 0.02);
  blob.scale.set(sc, sc * 0.7, 1);
  blob.rotation.z = -fm.euler().y;
  blob.material.opacity = 0.38 * clamp(1 - hAbove / 60, 0, 1);

  // 拉煙：從機尾噴出
  tmp.set(0, 0, fm.spec.length * 0.5 * vs).applyQuaternion(fm.q).add(fm.pos);
  smoke.update(dt, fm.crashed || fm.onGround ? null : tmp);
  smoke.mat.uniforms.scale.value = window.innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));

  // 風向袋
  world.sock.rotation.set(0, 0, 0);
  if (cfg.wind > 0) world.sock.lookAt(world.sock.position.clone().add(fm.wind));
  world.sock.rotateX(clamp(1.45 - cfg.wind * 0.18, 0.05, 1.45) + Math.sin(now / 280) * 0.04);

  updateDebris(dt);
  updateCamera(dt);
  updateHud(dt);
  updateMarker();
  drawSticks();
  updateAudio(camera.position.distanceTo(fm.pos));
  renderAll();
}

// ---------- 遊戲模式：主畫面／自由／教學 ----------
const game = { mode: null, lesson: null };
cfg.done = cfg.done || {};
function pause() { paused = true; if (gain) gain.gain.value = 0; }
function resume() { paused = false; audioStart(); last = performance.now(); accum = 0; }
function show(id) {
  for (const k of ['home', 'tutList', 'examList']) $(k).classList.toggle('show', k === id);
  if (id === 'tutList') buildLessons();
  if (id === 'examList') buildExamList();
  if (id === 'home') $('examBadge').textContent = cfg.examPassed ? '✓ 已合格' : (cfg.examBest ? `最佳 ${cfg.examBest} 分` : '定翼術科');
  if (id === 'home') $('tutProg').textContent = LESSONS.filter(l => cfg.done[l.id]).length + '/' + LESSONS.length;
}
function goHome() {
  pause(); game.mode = null; layoutPip(); tutor.stop(); guides.pattern.visible = guides.eight.visible = guides.ring.visible = false; examiner.stop(); $('mini').style.display = 'none';
  $('menu').classList.remove('show'); $('dlg').classList.remove('show'); $('tut').classList.remove('show');
  setHL(null);
  show('home');
}
function startFree() {
  game.mode = 'free'; game.lesson = null;
  loadPlane(cfg.plane);
  $('bAir').style.display = ''; $('bReset').style.display = ''; $('bReset').textContent = '重置';
  show(null); resume();
}

// 操作 → 搖桿位置（依 Mode 1／2）
const FN = { thr: '油門', ele: '升降舵', ail: '副翼', rud: '方向舵' };
function stickOf(fn) { return cfg.mode === 2 ? ({ thr: 'L', rud: 'L', ele: 'R', ail: 'R' })[fn] : ({ ele: 'L', rud: 'L', thr: 'R', ail: 'R' })[fn]; }
function where(fn) { return (stickOf(fn) === 'L' ? '左搖桿' : '右搖桿') + '的「' + (fn === 'thr' || fn === 'ele' ? '上下' : '左右') + '」方向'; }
const fill = t => t.replace(/\{(thr|ele|ail|rud)\}/g, (_, f) => '【' + where(f) + '】');
function setHL(list) {
  for (const k of ['L', 'R']) {
    const base = sticks[k].el.querySelector('.base');
    base.classList.remove('hl');
    base.querySelectorAll('.arr').forEach(a => a.remove());
  }
  if (!list) return;
  const DIR = { up: [0, -1, 0], down: [0, 1, 180], left: [-1, 0, 270], right: [1, 0, 90] };
  for (const [fn, d] of list) {
    const base = sticks[stickOf(fn)].el.querySelector('.base');
    base.classList.add('hl');
    const a = document.createElement('div'), [dx, dy, rot] = DIR[d];
    a.className = 'arr';
    a.style.left = (50 + dx * 34) + '%'; a.style.top = (50 + dy * 34) + '%';
    a.style.transform = `rotate(${rot}deg)`;
    base.appendChild(a);
  }
}

function dlg(title, text, acts, html) {
  $('dT').textContent = title; if (html) $('dP').innerHTML = html; else $('dP').textContent = text;
  const A = $('dA'); A.innerHTML = '';
  for (const [t, fn, pri] of acts) {
    const b = document.createElement('button'); b.textContent = t; if (pri) b.className = 'pri';
    b.onclick = () => { $('dlg').classList.remove('show'); fn(); };
    A.appendChild(b);
  }
  $('dlg').classList.add('show');
}

function buildLessons() {
  const el = $('lessons'); el.innerHTML = '';
  LESSONS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'lsn';
    b.innerHTML = `<div class="n">第 ${i + 1} 課</div><b>${L.icon} ${L.name}</b><span>${L.desc}</span>${cfg.done[L.id] ? '<div class="ok">✓ 完成</div>' : ''}`;
    b.onclick = () => openLesson(L);
    el.appendChild(b);
  });
}
function openLesson(L) {
  const i = LESSONS.indexOf(L);
  dlg(`第 ${i + 1} 課：${L.icon} ${L.name}`, fill(L.intro), [['返回', () => show('tutList')], ['開始練習', () => startLesson(L), true]]);
}
function startLesson(L) {
  game.mode = 'tut'; game.lesson = L;
  if (!fm || fm.spec !== PLANES.trainer) loadPlane('trainer');
  resetPlane(!!L.setup.air, L.setup);
  $('bAir').style.display = 'none'; $('bReset').textContent = '重來';
  show(null);
  $('tut').classList.add('show');
  tutor.start(L);
  resume();
}

const tutor = new Tutor({
  step(L, i, s) {
    $('tutL').textContent = `第 ${LESSONS.indexOf(L) + 1} 課 · ${L.name}`;
    $('tutN').textContent = `步驟 ${i + 1} / ${L.steps.length}`;
    $('tutT').textContent = fill(s.text);
    $('tutH').textContent = '';
    setHL(s.hl || null);
  },
  hint(t) { $('tutH').textContent = t; },
  good() {
    const t = $('tut'); t.classList.add('good'); setTimeout(() => t.classList.remove('good'), 700);
    if (navigator.vibrate) navigator.vibrate(40);
  },
  complete(L) {
    cfg.done[L.id] = true; save();
    setHL(null);
    setTimeout(() => {
      pause(); $('tut').classList.remove('show');
      const i = LESSONS.indexOf(L), next = LESSONS[i + 1];
      const acts = [['課程列表', () => { goHome(); show('tutList'); }]];
      if (next) acts.push(['下一課：' + next.name, () => openLesson(next), true]);
      else acts.push(['自由飛行', startFree, true]);
      dlg(`✅ 第 ${i + 1} 課完成！`, next ? `你已經學會「${L.name}」了。` : '恭喜完成全部新手教學！四個操作桿和降落都學會了，去自由模式盡情飛吧。', acts);
    }, 900);
  },
  fail(msg) {
    setHL(null);
    setTimeout(() => {
      pause(); $('tut').classList.remove('show');
      dlg('再試一次', msg, [['課程列表', () => { goHome(); show('tutList'); }], ['重來', () => startLesson(game.lesson), true]]);
    }, 600);
  },
});

$('mFree').onclick = startFree;
$('mTut').onclick = () => show('tutList');
$('mExam').onclick = openExam;

// ---------- 考照模式 ----------
const examModes = new Set();
function openExam() { show('examList'); }
function buildExamList() {
  cfg.practice = cfg.practice || {};
  const el = $('practiceList'); el.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const b = document.createElement('button'); b.className = 'lsn';
    const best = cfg.practice[it.id];
    b.innerHTML = `<div class="n">科目 ${it.code}</div><b>${it.name}</b><span>${it.brief.slice(0, 42)}…</span>${best != null ? `<div class="ok" style="color:${best >= 70 ? '#4cd98a' : '#ffb74d'}">最佳 ${best}</div>` : ''}`;
    b.onclick = () => openPractice(i);
    el.appendChild(b);
  });
  $('examBest').textContent = cfg.examPassed ? `✓ 已合格 · 最佳 ${cfg.examBest} 分` : (cfg.examBest ? `最佳 ${cfg.examBest} 分` : '尚未應考');
}
function openTest() {
  const list = ITEMS.map(it => `<b>${it.code}. ${it.name}</b><br><span style="opacity:.75;font-size:13px">${it.brief}</span>`).join('<br>');
  dlg('📋 測驗模式：完整術科（基本級）', '', [['返回', () => show('examList')], ['開始測驗', () => startExam(null), true]],
    `<span style="opacity:.75;font-size:13px">依民航局「無人飛機專業操作證術科測驗基準」程序連續進行：A 飛行前檢查 → B~F 術科 → G 飛行後檢查。</span><br>${list}<br><span style="opacity:.75;font-size:13px">定翼機術科建議使用「全手動模式」應考（成績單會記錄飛行模式）。重大違失（墜機、超越應考人後方、通過頭頂）立即不合格。各項 70 分以上為通過；航高 ${BAND[0]}–${BAND[1]} m 等數值為模擬設定。</span>`);
}
function openPractice(i) {
  const it = ITEMS[i];
  const start = it.practice ? '（直接從空中航線開始）' : '（從跑道上開始）';
  dlg(`🎯 練習：${it.code}. ${it.name}`, '', [['返回', () => show('examList')], ['開始練習', () => startExam(i), true]],
    `${it.brief}<br><span style="opacity:.7;font-size:13px">${start} 練習結果不會計入測驗成績。</span>`);
}
function checklist(title, items, done) {
  const st = items.map(() => false);
  const html = `<div class="chk">${items.map((t, i) => `<button data-i="${i}">☐ ${t}</button>`).join('')}</div>`;
  dlg(title, '', [['回主畫面', goHome], ['完成檢查', () => {}, true]], html);
  const btns = [...document.querySelectorAll('#dP .chk button')], go = $('dA').lastChild;
  go.disabled = true; go.style.opacity = 0.4;
  go.onclick = () => { if (st.every(Boolean)) { $('dlg').classList.remove('show'); done(); } };
  btns.forEach(b => b.onclick = () => {
    const i = +b.dataset.i; st[i] = !st[i];
    b.textContent = (st[i] ? '☑ ' : '☐ ') + items[i]; b.classList.toggle('on', st[i]);
    const all = st.every(Boolean); go.disabled = !all; go.style.opacity = all ? 1 : 0.4;
  });
}
// single = null：測驗模式（全部科目連續）；single = 索引：練習模式（單一科目）
function startExam(single = null) {
  game.mode = 'exam'; game.lesson = null; game.single = single; layoutPip();
  if (!fm || fm.spec !== PLANES.trainer) loadPlane('trainer');
  resetPlane(false, { z: ITEMS[0].setup.z });
  pause(); show(null);
  const go = () => {
    $('bAir').style.display = 'none';
    $('bReset').style.display = single !== null ? '' : 'none'; $('bReset').textContent = '重來';
    $('tut').classList.add('show'); $('mini').style.display = 'block';
    trail.length = 0;
    examModes.clear();
    examiner.start(single);
    resume();
  };
  if (single === null) checklist('A. 飛行前檢查', PRE_CHECK, go); else go();
}
const examiner = new Examiner({
  setup(it, i, so) {
    if (so) { resetPlane(!!so.air, so); if (i > 0 && game.single === null) toast('飛機已就定位', `${it.code}. ${it.name}`, 2.5); }
    setHL(null);
  },
  phase(i, it, p) {
    $('tutL').textContent = `${game.single !== null ? '練習' : '測驗'} · ${it.code}. ${it.name}`;
    $('tutN').textContent = `${p + 1} / ${it.phases.length}`;
    $('tutT').textContent = phaseText(it.phases[p]);
    $('tutH').textContent = '';
    if (p > 0) { const t = $('tut'); t.classList.add('good'); setTimeout(() => t.classList.remove('good'), 600); }
    updateAssistBtn();
    if (/開始迫降/.test(it.phases[p].text)) { toast('⚠️ 監評：開始迫降！', '立即將油門收至怠速（15% 以下）', 3); if (navigator.vibrate) navigator.vibrate([100, 60, 100]); }
  },
  hint(t) { $('tutH').textContent = t; },
  toast(a, b) { toast(a, b, 3); },
  itemDone(i, it, score, pass) {
    toast(`${pass ? '✅' : '❌'} ${it.code}. ${it.name}`, pass ? `通過 · ${score} 分` : `未通過 · ${score} 分`, 3);
  },
  report(res, fatal, practice) {
    if (practice) {
      const r = res[0], i = game.single, next = ITEMS[i + 1];
      cfg.practice = cfg.practice || {};
      cfg.practice[ITEMS[i].id] = Math.max(cfg.practice[ITEMS[i].id] ?? 0, r.score || 0); save();
      setTimeout(() => {
        pause(); $('tut').classList.remove('show');
        const acts = [['練習選單', () => { goHome(); show('examList'); }], ['再練一次', () => startExam(i), true]];
        if (next) acts.splice(1, 0, ['下一科', () => openPractice(i + 1)]);
        dlg(`${r.pass ? '✅ 通過' : '❌ 未通過'}　${r.code}. ${r.name}`, '', acts,
          `<div style="font-size:30px;font-weight:800;margin:4px 0">${r.score} 分</div>${r.notes.map(n => '• ' + n).join('<br>')}<br><span style="opacity:.6;font-size:13px">本科最佳 ${cfg.practice[ITEMS[i].id]} 分</span>`);
      }, fm.crashed ? 1800 : 700);
      return;
    }
    const finish = () => {
      pause(); $('tut').classList.remove('show');
      const ok = res.every(r => r.pass), total = res.reduce((a, r) => a + (r.score || 0), 0);
      cfg.examBest = Math.max(cfg.examBest || 0, total); if (ok) cfg.examPassed = true; save();
      const rows = res.map(r => `<tr><td>${r.code}. ${r.name}</td><td class="sc">${r.score ?? '—'}</td><td>${r.score === null ? '⏸' : r.pass ? '✅' : '❌'}</td></tr><tr><td colspan="3" class="nt">${r.notes.join('、')}</td></tr>`).join('');
      dlg(ok ? '🎉 術科測驗合格！' : '術科測驗不合格', '', [['考照選單', () => { goHome(); show('examList'); }], ['再考一次', () => startExam(null), true]],
        `<table class="rep">${rows}</table><div style="margin-top:8px">總分 <b>${total}</b> / ${ITEMS.length * 100}　·　最佳 ${cfg.examBest}　·　飛行模式：${examModes.size > 1 ? '混用' : examModes.has(true) ? '水平自穩' : '全手動'}</div>`);
    };
    setTimeout(() => {
      if (fatal) finish();
      else { pause(); $('tut').classList.remove('show'); checklist('G. 飛行後檢查', POST_CHECK, finish); }
    }, fm.crashed ? 1800 : 900);
  },
});

// 小地圖（從飛手視角：上方＝前方/西，右方＝北）
const trail = [];
let miniT = 0;
function drawMini(dt) {
  miniT += dt; if (miniT < 0.1) return; miniT = 0;
  trail.push([fm.pos.x, fm.pos.z]); if (trail.length > 600) trail.shift();
  const cv = $('mini'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const k = Math.min(W / 470, H / 250), cx = -55;
  const P = (x, z) => [W / 2 - z * k, H / 2 + (x - cx) * k];
  g.fillStyle = 'rgba(70,110,50,0.55)'; g.fillRect(0, 0, W, H);
  // 跑道
  g.fillStyle = '#555'; let [a1, b1] = P(-6, 70), [a2, b2] = P(6, -70); g.fillRect(a1, b1, a2 - a1, b2 - b1);
  const it = examiner.active ? ITEMS[examiner.item] : null;
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.2; g.setLineDash([4, 3]);
  if (it && it.id === 'eight') {
    for (const sgn of [1, -1]) { const [px, py] = P(C8.x, C8.z + sgn * C8.r); g.beginPath(); g.arc(px, py, C8.r * k, 0, 7); g.stroke(); }
    const [px, py] = P(C8.x, C8.z); g.setLineDash([]); g.strokeStyle = '#ffd54f'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px - 5, py); g.lineTo(px + 5, py); g.moveTo(px, py - 5); g.lineTo(px, py + 5); g.stroke();
  } else if (it) {
    const pts = [P(0, PAT.zS), P(0, PAT.zN), P(PAT.xFar, PAT.zN), P(PAT.xFar, PAT.zS)];
    if (it.id === 'taxi') pts.length = 0;
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
  }
  g.setLineDash([]);
  // 軌跡
  g.strokeStyle = 'rgba(255,170,60,0.85)'; g.lineWidth = 1.5; g.beginPath();
  trail.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
  // 飛手
  const [fx, fy] = P(PILOT.x, PILOT.z); g.fillStyle = '#29b6f6'; g.beginPath(); g.arc(fx, fy, 3.5, 0, 7); g.fill();
  // 飛機
  const [px, py] = P(fm.pos.x, fm.pos.z), yaw = fm.euler().y;
  g.save(); g.translate(px, py); g.rotate(Math.PI / 2 - yaw);
  g.fillStyle = examiner.S && examiner.S.idle ? '#ff5252' : '#fff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
  g.restore();
}

$('tlBack').onclick = () => show('home');
$('elBack').onclick = () => show('home');
$('mTest').onclick = openTest;
$('hSet').onclick = () => { show(null); $('menu').classList.add('show'); $('bGo').textContent = '完成'; $('bHome').style.display = 'none'; };
window.__pause = () => { if (game.mode && !paused) $('bMenu').click(); };
window.__back = () => {
  if ($('dlg').classList.contains('show')) return 'ok';
  if ($('tutList').classList.contains('show') || $('examList').classList.contains('show')) { show('home'); return 'ok'; }
  if ($('home').classList.contains('show')) return 'exit';
  if ($('menu').classList.contains('show')) { $('bGo').click(); return 'ok'; }
  $('bMenu').click(); return 'ok';
};

// ---------- 選單 ----------
let paused = true;
function buildMenu() {
  const ps = $('planeSel'); ps.innerHTML = '';
  const desc = { trainer: '1220 mm 上單翼、約 1.1 kg、穩定好飛，新手首選', sport: '高舵量、推重比 >1，可做 3D 懸停與特技', glider: '長翼展、超省力，關油門也能滑翔很久' };
  for (const k of Object.keys(PLANES)) {
    const b = document.createElement('button');
    b.className = 'opt' + (cfg.plane === k ? ' sel' : '');
    b.innerHTML = `<b>${PLANES[k].name}</b><span>${desc[k]}</span>`;
    b.onclick = () => { cfg.plane = k; save(); buildMenu(); if (game.mode !== 'tut') { loadPlane(k); } };
    ps.appendChild(b);
  }
  const opts = (id, list, key, cb) => {
    const el = $(id); el.innerHTML = '';
    list.forEach(([v, t, d]) => {
      const b = document.createElement('button');
      b.className = 'opt' + (cfg[key] === v ? ' sel' : '');
      b.innerHTML = `<b>${t}</b><span>${d}</span>`;
      b.onclick = () => { cfg[key] = v; save(); cb(); buildMenu(); };
      el.appendChild(b);
    });
  };
  const asEl = $('assistSel'); asEl.innerHTML = '';
  const AS = [['assist', '輔助模式總開關', '關閉時以下全部停用；正式測驗一律不提供'], ['stall', '失速保護', '速度太慢、拉太多時自動壓機頭'], ['coord', '自動協調轉彎', '自動配合方向舵，轉彎不側滑'], ['roll', '滑跑保持直線', '起飛滑跑自動對正跑道中心線'], ['reverse', '迎面左右反向', '飛機朝你飛來時，左右操作自動反過來（符合畫面方向）'], ['marker', '飛機方向標記', '主畫面在飛機旁顯示機頭方向與高度']];
  for (const [k, t, d] of AS) {
    const b = document.createElement('button');
    const on = k === 'assist' ? cfg.assist : cfg.as[k];
    b.className = 'opt' + (on ? ' sel' : ''); b.style.minWidth = '150px';
    b.innerHTML = `<b>${on ? '☑' : '☐'} ${t}</b><span>${d}</span>`;
    b.onclick = () => { if (k === 'assist') cfg.assist = !cfg.assist; else cfg.as[k] = !cfg.as[k]; save(); buildMenu(); updateAssistBtn(); };
    asEl.appendChild(b);
  }
  opts('fmodeSel', [['stab', '水平自穩模式', '放開副翼／升降會自動改平，坡度限 50°、俯仰限 30°（類似教練機的自穩）'], ['manual', '全手動模式', '搖桿直接控制舵面角速率，不會自動改平，考照建議用這個練']], 'fmode', () => {});
  opts('siteSel', [['zhutian', '竹田飛行場', '依空拍圖概略重建：水泥跑道、直升機坪、停車場、河道'], ['std', '標準練習場', '柏油跑道、機棚、池塘']], 'site', () => { toast('切換場地中…'); setTimeout(() => location.reload(), 300); });
  opts('camSel', [[1, '地面目視', '站在跑道邊看飛機，最像真實飛 RC'], [0, '第三人稱', '鏡頭跟在飛機後方'], [2, '第一人稱', '從機頭看出去（FPV）']], 'cam', () => setCam(cfg.cam));
  opts('pipSel', [[1, '第三人稱', '水平朝操作者前方、角度固定，飛機占滿小窗'], [2, '第一人稱', '小窗顯示機頭畫面'], [0, '關閉', '只看地面視角']], 'pip', () => setCam(cfg.cam));
  $('pipRow').style.opacity = cfg.cam === 1 ? 1 : 0.45;
  const pt = $('paintSel'); pt.innerHTML = '';
  for (const [k, v] of Object.entries(PAINTS)) {
    const b = document.createElement('button');
    b.className = 'swatch' + (cfg.paint === k ? ' sel' : '');
    b.style.background = '#' + v.c.toString(16).padStart(6, '0');
    b.textContent = v.name;
    b.onclick = () => { cfg.paint = k; save(); buildMenu(); if (fm && fm.spec.detail === 'trainer') { const p = fm.pos.clone(), q = fm.q.clone(); scene.remove(mdl.group); mdl = buildPlane(fm.spec, cfg.paint); scene.add(mdl.group); mdl.group.position.copy(p); mdl.group.quaternion.copy(q); } };
    pt.appendChild(b);
  }
  for (const b of $('modeSel').children) {
    b.classList.toggle('sel', +b.dataset.mode === cfg.mode);
    b.onclick = () => { cfg.mode = +b.dataset.mode; save(); buildMenu(); layoutSticks(); setThrottleStick(input.thr); };
  }
  const sl = (id, key, fmt, cb) => {
    const el = $(id), out = el.nextElementSibling;
    el.value = cfg[key]; out.textContent = fmt(cfg[key]);
    el.oninput = () => { cfg[key] = +el.value; out.textContent = fmt(cfg[key]); save(); cb && cb(); };
  };
  sl('sRate', 'rate', v => v + '%');
  sl('sExpo', 'expo', v => v + '%');
  sl('sWind', 'wind', v => v + ' m/s', applyWind);
  sl('sGust', 'gust', v => v + '%', applyWind);
  sl('sQual', 'qual', v => v ? '高' : '省電', () => toast('畫質', '重新開啟 App 後生效'));
  sl('sVol', 'vol', v => v + '%');
  buildMap();
}

function buildMap() {
  const tb = $('mapTbl'); tb.innerHTML = '';
  const names = { ail: '副翼', ele: '升降', thr: '油門', rud: '方向', mode: '自穩開關' };
  for (const f of ['ail', 'ele', 'thr', 'rud', 'mode']) {
    const tr = document.createElement('tr');
    const opts = (f === 'mode' ? `<option value="-1" ${cfg.map[f][0] < 0 ? 'selected' : ''}>不使用</option>` : '') + AXN.map((n, i) => `<option value="${i}" ${cfg.map[f][0] === i ? 'selected' : ''}>${n}</option>`).join('');
    tr.innerHTML = `<td>${names[f]}</td><td><select>${opts}</select></td><td><label><input type="checkbox" ${cfg.map[f][1] ? 'checked' : ''}> 反向</label></td><td style="width:40%"><div class="bar"><i></i></div></td><td><button class="btn" style="height:32px">偵測</button></td>`;
    const [sel, chk, btn] = [tr.querySelector('select'), tr.querySelector('input'), tr.querySelector('button')];
    sel.onchange = () => { cfg.map[f][0] = +sel.value; save(); };
    chk.onchange = () => { cfg.map[f][1] = chk.checked; save(); };
    btn.onclick = () => detectAxis(f, sel, btn);
    tr.dataset.f = f;
    tb.appendChild(tr);
  }
  $('bPad').textContent = '遙控器：' + (cfg.pad ? '開' : '關');
  $('bPad').classList.toggle('on', cfg.pad);
}
function detectAxis(f, sel, btn) {
  if (!padAxes) { toast('找不到遙控器', '請用 USB OTG 接上並切到搖桿模式'); return; }
  const base = padAxes.slice(), dev = new Array(12).fill(0);
  btn.textContent = '撥動…';
  const iv = setInterval(() => { padAxes.forEach((v, i) => { dev[i] = Math.max(dev[i], Math.abs(v - base[i])); }); }, 30);
  setTimeout(() => {
    clearInterval(iv);
    let best = 0; dev.forEach((d, i) => { if (d > dev[best]) best = i; });
    btn.textContent = '偵測';
    if (dev[best] < 0.2) { toast('沒有偵測到動作'); return; }
    cfg.map[f][0] = best; sel.value = best; save();
    toast(`已設定為 ${AXN[best]} 軸`);
  }, 2500);
}
function menuTick() {
  if (!$('menu').classList.contains('show')) return;
  pollWebPad();
  const ok = padAxes && performance.now() - padSeen < 3000;
  $('padInfo').textContent = ok ? '已連接：' + (padName || 'USB 遙控器') : '尚未偵測到遙控器';
  for (const tr of $('mapTbl').children) {
    const f = tr.dataset.f, [i, inv] = cfg.map[f];
    let v = ok && i >= 0 ? (padAxes[i] || 0) : 0; if (inv) v = -v;
    tr.querySelector('.bar i').style.width = ((v + 1) * 50) + '%';
  }
}
setInterval(menuTick, 60);

$('bPad').onclick = () => { cfg.pad = !cfg.pad; save(); buildMap(); };
$('bGo').onclick = () => {
  $('menu').classList.remove('show');
  if (!game.mode) { show('home'); return; }
  resume();
};
$('bMenu').onclick = () => { pause(); $('menu').classList.add('show'); $('bGo').textContent = '繼續飛行'; $('bHome').style.display = ''; };
$('bHome').onclick = goHome;
$('bReset').onclick = () => game.mode === 'tut' ? startLesson(game.lesson) : game.mode === 'exam' ? (game.single !== null && startExam(game.single)) : resetPlane(false);
$('bAir').onclick = () => resetPlane(true);
function updateModeBtn() {
  const b = $('bMode'); if (!b) return;
  b.textContent = input.stab ? '自穩' : '手動';
  b.classList.toggle('on', !!input.stab);
}
$('bMode').onclick = () => { cfg.fmode = cfg.fmode === 'stab' ? 'manual' : 'stab'; save(); buildMenu(); toast(cfg.fmode === 'stab' ? '水平自穩模式' : '全手動模式', cfg.fmode === 'stab' ? '放開副翼／升降搖桿會自動改平，坡度與俯仰角有上限' : '搖桿直接控制舵面，飛機不會自己改平', 2.2); };
updateModeBtn();
function updateAssistBtn() { const b = $('bAssist'); b.textContent = '輔助'; b.classList.toggle('on', assistOn()); }
$('bAssist').onclick = () => {
  if (game.mode === 'exam' && game.single === null) { toast('測驗模式不提供輔助', '正式考試請自行操作'); return; }
  cfg.assist = !cfg.assist; save(); updateAssistBtn(); buildMenu();
  toast(cfg.assist ? '輔助模式：開' : '輔助模式：關', cfg.assist ? assistDesc() : '所有輔助功能已關閉', 2.6);
};
function assistDesc() {
  const n = { stall: '失速保護', coord: '自動協調轉彎', roll: '滑跑保持直線', reverse: '迎面左右反向', marker: '飛機方向標記' };
  return Object.keys(n).filter(k => cfg.as[k]).map(k => n[k]).join('、') || '（未勾選任何項目）';
}
updateAssistBtn();
$('bCam').onclick = () => { setCam((cfg.cam + 1) % 3); buildMenu(); };
$('bPip').onclick = () => { cfg.pip = (cfg.pip + 1) % 3; setCam(cfg.cam); buildMenu(); };
setCam(cfg.cam);

loadPlane(cfg.plane);
buildMenu();
goHome();
resize();
updateCamera(0.016);
requestAnimationFrame(frame);
window.__dbg = { get fm() { return fm; }, input, sticks, setThrottleStick, cfg, game, examiner, camera, pipCam, scene, renderer, pause: () => pause(), get mdl() { return mdl; } };
