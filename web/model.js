// RC 飛機 3D 模型：旋轉體機身、翼型主翼、可動舵面、螺旋槳
import * as THREE from 'three';
import { buildTrainer } from './trainer.js';

const paint = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.32, metalness: 0.08, ...o });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// 翼型剖面（NACA 厚度分佈；flat=平底翼）→ 沿 +X 擠出，前緣朝 -Z
function wingGeo(chord, span, thick, flat, taper = 1) {
  const s = new THREE.Shape();
  const N = 18, up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const u = (1 - Math.cos(Math.PI * i / N)) / 2;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const x = chord * 0.3 - u * chord;
    up.push([x, flat ? yt * 1.6 : yt]);
    lo.push([x, flat ? -yt * 0.15 : -yt]);
  }
  s.moveTo(up[0][0], up[0][1]);
  for (let i = 1; i <= N; i++) s.lineTo(up[i][0], up[i][1]);
  for (let i = N; i >= 0; i--) s.lineTo(lo[i][0], lo[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, steps: 1 });
  g.rotateY(Math.PI / 2);
  if (taper !== 1) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 - (1 - taper) * (p.getX(i) / span); p.setZ(i, p.getZ(i) * k); p.setY(i, p.getY(i) * k); }
  }
  g.computeVertexNormals();
  return g;
}

// 尾翼：梯形平面（前緣在 z=0，往 +Z 為後緣）
function planform(rootC, tipC, span, sweep, thick, mat, vertical = false) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(span, -sweep); s.lineTo(span, -sweep - tipC); s.lineTo(0, -rootC); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.4, bevelSegments: 2 });
  g.translate(0, 0, -thick / 2);
  if (vertical) g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1));
  else g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function textTex(text, color, w = 512, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = `bold ${h * 0.62}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildPlane(spec, paint) {
  if (spec.detail === 'trainer') return buildTrainer(paint);
  const g = new THREE.Group();
  const main = paint(spec.color), acc = paint(spec.accent), dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c2236, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.6 });
  const L = spec.length, b = spec.span;
  const glider = !!spec.glider, sport = !spec.highWing;
  const chord = glider ? 0.17 : 0.25;
  const wingY = spec.highWing ? 0.075 : -0.04;
  const dih = (glider ? 4 : spec.dihedral > 1 ? 3 : 0.5) * Math.PI / 180;

  // 機身：旋轉體
  const R = glider ? 0.06 : 0.078, mid = glider ? 0.3 : 0.45, tailR = glider ? 0.014 : 0.026;
  const radius = t => {
    if (t < 0.12) return R * (0.55 + 0.45 * Math.sin(t / 0.12 * Math.PI / 2));
    if (t < mid) return R;
    const k = (t - mid) / (1 - mid); return R * (1 - k) + tailR * k;
  };
  const len = L * 0.96, zOff = L * 0.02;
  const zAt = t => (t - 0.5) * len + zOff;
  const prof = [new THREE.Vector2(0.001, -0.5 * len)];
  for (let i = 0; i <= 24; i++) prof.push(new THREE.Vector2(radius(i / 24), (i / 24 - 0.5) * len));
  prof.push(new THREE.Vector2(0.001, 0.5 * len));
  const fg = new THREE.LatheGeometry(prof, 22);
  fg.rotateX(Math.PI / 2);
  const fus = new THREE.Mesh(fg, main);
  fus.scale.set(1, 1.18, 1); fus.position.z = zOff;
  g.add(fus);
  // 機身飾條（側面）
  const stripeG = new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x * 1.015, v.y)), 22, Math.PI / 2 - 0.3, 0.6);
  stripeG.rotateX(Math.PI / 2);
  for (const sgn of [1, -1]) { const st = new THREE.Mesh(stripeG, acc); st.scale.set(sgn, 1.18, 1); st.position.z = zOff; g.add(st); }
  if (!glider) {
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.0, R * 0.8, L * 0.1, 22), acc);
    cowl.rotation.x = Math.PI / 2; cowl.position.z = -L * 0.43; g.add(cowl);
  }
  // 座艙罩
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.82, 0.95, glider ? 2.8 : 2.1);
  canopy.position.set(0, glider ? 0.045 : 0.07, -L * (glider ? 0.25 : 0.18)); g.add(canopy);
  // 機身側面文字
  const tDec = 0.56, rDec = radius(tDec);
  const nameT = textTex('ynfly_fpv', '#111');
  for (const sgn of [1, -1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.26, L * 0.05), new THREE.MeshBasicMaterial({ map: nameT, transparent: true, depthWrite: false }));
    d.position.set(sgn * (rDec + 0.004), -0.012, zAt(tDec)); d.rotation.y = sgn * Math.PI / 2; g.add(d);
  }

  // 主翼
  const ail = {};
  const half = b / 2;
  const wg = wingGeo(chord, half * 0.84, glider ? 0.1 : 0.13, !sport, glider ? 0.8 : 1);
  const tg = wingGeo(chord * (glider ? 0.8 : 1), half * 0.16, glider ? 0.1 : 0.13, !sport, glider ? 0.6 : 1);
  for (const side of [1, -1]) {
    const h = new THREE.Group();
    h.position.set(0, wingY, -L * 0.12);
    h.rotation.z = side * dih;
    h.scale.x = side;
    h.add(new THREE.Mesh(wg, main));
    const tip = new THREE.Mesh(tg, acc); tip.position.x = half * 0.84; h.add(tip);
    const ac = chord * 0.24, aspan = half * 0.42;
    const a = new THREE.Group(); a.position.set(half * 0.4, 0.0, chord * 0.7 - ac);
    a.add(box(aspan, 0.012, ac, acc, aspan / 2, 0, ac / 2));
    h.add(a);
    ail[side > 0 ? 'R' : 'L'] = a;
    g.add(h);
  }
  if (spec.highWing && !glider) {
    for (const side of [1, -1]) {
      const st = box(0.01, 0.01, 0.3, dark);
      st.position.set(side * 0.22, 0.0, -L * 0.12); st.rotation.set(0, 0, side * 0.75); st.scale.set(1, 1, 0.25);
      g.add(st);
    }
  }

  // 尾翼
  const tz = L * 0.36;
  const tailUp = glider ? 0.24 : 0.0;
  const hsSpan = glider ? 0.19 : 0.24;
  for (const side of [1, -1]) {
    const hs = planform(0.11, 0.075, hsSpan, 0.03, 0.008, main);
    hs.position.set(0, 0.02 + tailUp, tz); hs.scale.x = side; g.add(hs);
  }
  const elev = new THREE.Group(); elev.position.set(0, 0.02 + tailUp, tz + 0.105);
  elev.add(box(hsSpan * 2 * 0.92, 0.009, 0.055, acc, 0, 0, 0.0275)); g.add(elev);
  const finH = glider ? 0.27 : 0.17;
  const fin = planform(0.16, 0.08, finH, 0.07, 0.008, main, true);
  fin.position.set(0, R * 0.6, tz - 0.02); g.add(fin);
  const rud = new THREE.Group(); rud.position.set(0, R * 0.6 + finH * 0.48, tz + 0.125);
  rud.add(box(0.009, finH * 0.92, 0.06, acc, 0, 0, 0.03)); g.add(rud);

  // 螺旋槳
  const prop = new THREE.Group();
  prop.position.z = -L * 0.5 - (glider ? 0.0 : 0.02);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(glider ? 0.03 : 0.038, 0.08, 22), chrome);
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.03; prop.add(spinner);
  const blades = new THREE.Group();
  const bladeLen = glider ? 0.22 : 0.27;
  for (const sgn of [1, -1]) {
    const bl = box(bladeLen / 2, 0.026, 0.006, dark, sgn * bladeLen / 4, 0, 0);
    bl.rotation.x = sgn * 0.25; blades.add(bl);
  }
  prop.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(bladeLen / 2, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  g.add(prop);
  const discHolder = new THREE.Group(); discHolder.position.copy(prop.position); discHolder.add(disc); g.add(discHolder);

  // 起落架
  const tireG = new THREE.TorusGeometry(0.03, 0.013, 10, 20); tireG.rotateY(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12); hubG.rotateZ(Math.PI / 2);
  const wheel = (x, y, z, pant) => {
    const t = new THREE.Mesh(tireG, dark); t.position.set(x, y, z); g.add(t);
    const hb = new THREE.Mesh(hubG, chrome); hb.position.set(x, y, z); g.add(hb);
    if (pant) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), main); p.scale.set(0.45, 0.6, 1.4); p.position.set(x, y + 0.012, z); g.add(p); }
  };
  const strutM = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.3, metalness: 0.8 });
  if (!glider) {
    for (const s of [1, -1]) {
      const strut = box(0.01, 0.11, 0.016, strutM, s * 0.085, -0.075, -0.1);
      strut.rotation.z = -s * 0.5; g.add(strut);
      wheel(s * 0.12, -0.097, -0.1, sport);
    }
    g.add(box(0.008, 0.1, 0.01, strutM, 0, -0.07, -L * 0.4));
    wheel(0, -0.097, -L * 0.4, false);
  } else {
    wheel(0, -0.097, -0.05, false);
    g.add(box(0.02, 0.03, 0.25, dark, 0, -0.065, -L * 0.3));
  }

  g.traverse(o => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    group: g, prop, disc,
    update(ctrl, rpm, dt) {
      const k = 0.45;
      ail.R.rotation.x = -ctrl.ail * k;
      ail.L.rotation.x = ctrl.ail * k;
      elev.rotation.x = -ctrl.ele * k;
      rud.rotation.y = ctrl.rud * k;
      prop.rotation.z += rpm * dt;
      disc.material.opacity = Math.min(0.3, Math.max(0, (rpm - 20) / 60));
      blades.visible = rpm < 45;
    },
  };
}
