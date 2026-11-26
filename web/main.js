import * as THREE from 'three';
import { FlightModel, PLANES } from './physics.js';
import { terrainHeight } from './terrain.js';
import { buildWorld, PILOT } from './world.js';
import { buildPlane } from './model.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 設定 ----------
const DEF = { plane: 'trainer', mode: 2, rate: 80, expo: 30, wind: 2, gust: 30, qual: 1, vol: 50, cam: 1, pip: 1,
  pad: false, map: { ail: [0, false], ele: [1, true], thr: [2, true], rud: [3, false] } };
let cfg;
try { cfg = Object.assign({}, DEF, JSON.parse(localStorage.getItem('rcsim') || '{}')); } catch (e) { cfg = { ...DEF }; }
cfg.map = Object.assign({}, DEF.map, cfg.map);
const save = () => { try { localStorage.setItem('rcsim', JSON.stringify(cfg)); } catch (e) {} };

// ---------- 渲染 ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: cfg.qual > 0, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.qual > 0 ? 2 : 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
const world = buildWorld(scene, cfg.qual);

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
  mdl = buildPlane(spec);
  scene.add(mdl.group);
  applyWind();
  resetPlane(false);
}

function applyWind() {
  const a = -0.6; // 風從西南方吹來
  fm.wind.set(Math.cos(a) * cfg.wind, 0, Math.sin(a) * cfg.wind);
  fm.gust = cfg.gust / 100;
}

// 起飛方向：逆風起飛
function resetPlane(air) {
  clearDebris();
  const heading = 0;
  fm.reset(0, 50, heading);
  if (air) {
    fm.pos.set(0, 45, 60);
    fm.vel.set(0, 0, -fm.spec.vref * 1.25);
    fm.onGround = false;
    setThrottleStick(0.5);
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
  const dist = 3.2 + fm.spec.span;
  const target = p.clone().addScaledVector(st.fwd, -dist * 0.75).addScaledVector(hz, -dist * 0.35);
  target.y += 1.0 + fm.spec.span * 0.3;
  if (!st.init) st.pos.copy(target);
  st.pos.lerp(target, 1 - Math.exp(-6 * dt));
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
  const d = (fm.spec.span / 2) / Math.tan(half) * 1.25;
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
  if (pipActive()) runCam(cfg.pip === 1 ? 3 : 2, pipCam, pipState, dt);
}
const pipActive = () => cfg.cam === 1 && cfg.pip > 0;
function pipRect() {
  const W = window.innerWidth, H = window.innerHeight;
  const w = Math.round(Math.min(W * 0.34, 340, H * 0.55)), h = Math.round(w * 0.62);
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
  }
  if (fm.event) {
    const ev = fm.event; fm.event = null;
    if (ev.type === 'crash') { explode(); toast('💥 墜機', ev.text + '　·　點「重置」再飛一次', 3.5); crashTimer = 4; if (navigator.vibrate) navigator.vibrate(120); }
    else toast(ev.text === '完美降落！' ? '🛬 ' + ev.text : ev.text, '接地速度 ' + (ev.score * 3.6).toFixed(0) + ' km/h', 2.5);
  }
  if (fm.crashed && crashTimer > 0) { crashTimer -= dt; if (crashTimer <= 0) resetPlane(false); }

  // 更新模型
  mdl.group.position.copy(fm.pos);
  mdl.group.quaternion.copy(fm.q);
  mdl.update(input, fm.crashed ? 0 : input.thr * (fm.spec.glider ? 70 : 90) + (input.thr > 0.02 ? 15 : 0), dt);

  // 地面陰影
  const gh = terrainHeight(fm.pos.x, fm.pos.z);
  const hAbove = fm.pos.y - gh;
  blob.visible = !fm.crashed && hAbove < 60;
  blob.position.set(fm.pos.x, gh + 0.05, fm.pos.z);
  const sc = fm.spec.span * 0.45 * (1 + hAbove * 0.02);
  blob.scale.set(sc, sc * 0.7, 1);
  blob.rotation.z = -fm.euler().y;
  blob.material.opacity = 0.38 * clamp(1 - hAbove / 60, 0, 1);

  // 拉煙：從機尾噴出
  tmp.set(0, 0, fm.spec.length * 0.5).applyQuaternion(fm.q).add(fm.pos);
  smoke.update(dt, fm.crashed || fm.onGround ? null : tmp);
  smoke.mat.uniforms.scale.value = window.innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));

  // 風向袋
  world.sock.rotation.set(0, 0, 0);
  if (cfg.wind > 0) world.sock.lookAt(world.sock.position.clone().add(fm.wind));
  world.sock.rotateX(clamp(1.45 - cfg.wind * 0.18, 0.05, 1.45) + Math.sin(now / 280) * 0.04);

  updateDebris(dt);
  updateCamera(dt);
  updateHud(dt);
  drawSticks();
  updateAudio(camera.position.distanceTo(fm.pos));
  renderAll();
}

// ---------- 選單 ----------
let paused = true;
function buildMenu() {
  const ps = $('planeSel'); ps.innerHTML = '';
  const desc = { trainer: '上單翼、穩定、會自己回正，新手首選', sport: '高舵量、推重比 >1，可做 3D 懸停與特技', glider: '長翼展、超省力，關油門也能滑翔很久' };
  for (const k of Object.keys(PLANES)) {
    const b = document.createElement('button');
    b.className = 'opt' + (cfg.plane === k ? ' sel' : '');
    b.innerHTML = `<b>${PLANES[k].name}</b><span>${desc[k]}</span>`;
    b.onclick = () => { cfg.plane = k; save(); buildMenu(); loadPlane(k); };
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
  opts('camSel', [[1, '地面目視', '站在跑道邊看飛機，最像真實飛 RC'], [0, '第三人稱', '鏡頭跟在飛機後方'], [2, '第一人稱', '從機頭看出去（FPV）']], 'cam', () => setCam(cfg.cam));
  opts('pipSel', [[1, '第三人稱', '水平朝操作者前方、角度固定，飛機占滿小窗'], [2, '第一人稱', '小窗顯示機頭畫面'], [0, '關閉', '只看地面視角']], 'pip', () => setCam(cfg.cam));
  $('pipRow').style.opacity = cfg.cam === 1 ? 1 : 0.45;
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
  const names = { ail: '副翼', ele: '升降', thr: '油門', rud: '方向' };
  for (const f of ['ail', 'ele', 'thr', 'rud']) {
    const tr = document.createElement('tr');
    const opts = AXN.map((n, i) => `<option value="${i}" ${cfg.map[f][0] === i ? 'selected' : ''}>${n}</option>`).join('');
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
    let v = ok ? (padAxes[i] || 0) : 0; if (inv) v = -v;
    tr.querySelector('.bar i').style.width = ((v + 1) * 50) + '%';
  }
}
setInterval(menuTick, 60);

$('bPad').onclick = () => { cfg.pad = !cfg.pad; save(); buildMap(); };
$('bGo').onclick = () => { $('menu').classList.remove('show'); paused = false; audioStart(); last = performance.now(); };
$('bMenu').onclick = () => { $('menu').classList.add('show'); paused = true; $('bGo').textContent = '繼續飛行'; if (gain) gain.gain.value = 0; };
$('bReset').onclick = () => resetPlane(false);
$('bAir').onclick = () => resetPlane(true);
$('bSmoke').onclick = () => { smoke.on = !smoke.on; $('bSmoke').classList.toggle('on', smoke.on); };
$('bCam').onclick = () => { setCam((cfg.cam + 1) % 3); buildMenu(); };
$('bPip').onclick = () => { cfg.pip = (cfg.pip + 1) % 3; setCam(cfg.cam); buildMenu(); };
setCam(cfg.cam);

loadPlane(cfg.plane);
buildMenu();
resize();
updateCamera(0.016);
requestAnimationFrame(frame);
window.__dbg = { get fm() { return fm; }, input, sticks, setThrottleStick, cfg };
