// 低多邊形 RC 飛機 3D 模型（含可動舵面與螺旋槳）
import * as THREE from 'three';

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// 鉸鏈：子物件從鉸鏈線往後延伸
function hinged(w, h, d, mat, x, y, z, vertical = false) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = vertical ? box(h, w, d, mat, 0, 0, d / 2) : box(w, h, d, mat, 0, 0, d / 2);
  g.add(m);
  return g;
}

export function buildPlane(spec) {
  const g = new THREE.Group();
  const main = lam(spec.color), acc = lam(spec.accent), dark = lam(0x222222);
  const L = spec.length, b = spec.span;
  const glider = !!spec.glider;
  const chord = glider ? 0.17 : 0.25;
  const wingY = spec.highWing ? 0.085 : -0.045;
  const dih = (glider ? 4 : spec.dihedral > 1 ? 3 : 0.5) * Math.PI / 180;

  // 機身（錐形）
  const fg = new THREE.CylinderGeometry(glider ? 0.018 : 0.03, glider ? 0.06 : 0.075, L * 0.92, 10);
  fg.rotateX(Math.PI / 2);
  const fus = new THREE.Mesh(fg, main);
  fus.position.z = L * 0.04; fus.scale.set(1, 1.15, 1);
  g.add(fus);
  // 機鼻罩 / 機頭
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(glider ? 0.06 : 0.076, 12, 8), glider ? main : acc);
  cowl.scale.set(1, 1.1, 1.4); cowl.position.z = -L * 0.42; g.add(cowl);
  // 座艙罩
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x1a3550, { emissive: 0x0a1a2a }));
  canopy.scale.set(0.8, 0.85, glider ? 2.6 : 2.0);
  canopy.position.set(0, glider ? 0.04 : 0.06, -L * (glider ? 0.25 : 0.2)); g.add(canopy);
  // 機身裝飾條
  const stripe = box(0.152, 0.03, L * 0.6, acc, 0, 0.0, L * 0.05); g.add(stripe);

  // 主翼（左右兩半，含上反角與副翼）
  const ail = {};
  for (const side of [1, -1]) {
    const half = new THREE.Group();
    half.position.set(0, wingY, -L * 0.12);
    half.rotation.z = side * dih;
    const span = b / 2;
    const w = box(span, 0.026, chord, main, side * span / 2, 0, 0);
    half.add(w);
    half.add(box(span * 0.18, 0.028, chord + 0.002, acc, side * span * 0.91, 0, 0));
    const a = hinged(span * 0.42, 0.016, chord * 0.26, acc, side * span * 0.68, 0, chord / 2);
    half.add(a);
    ail[side > 0 ? 'R' : 'L'] = a;
    g.add(half);
  }
  if (spec.highWing && !glider) {
    // 翼撐
    for (const side of [1, -1]) {
      const st = box(0.012, 0.012, 0.32, dark);
      st.position.set(side * 0.28, 0.0, -L * 0.12);
      st.rotation.set(0, 0, side * 0.6);
      st.scale.set(1, 1, 0.3);
      g.add(st);
    }
  }

  // 尾翼
  const tz = L * 0.42;
  const tailUp = glider ? 0.24 : 0.0;
  const hs = box(glider ? 0.36 : 0.46, 0.015, 0.1, main, 0, 0.02 + tailUp, tz); g.add(hs);
  const elev = hinged(glider ? 0.36 : 0.46, 0.012, 0.07, acc, 0, 0.02 + tailUp, tz + 0.05); g.add(elev);
  const fin = box(0.014, glider ? 0.26 : 0.17, 0.12, main, 0, (glider ? 0.13 : 0.1), tz - 0.01); g.add(fin);
  const rud = hinged(glider ? 0.26 : 0.17, 0.012, 0.07, acc, 0, (glider ? 0.13 : 0.1), tz + 0.05, true); g.add(rud);

  // 螺旋槳
  const prop = new THREE.Group();
  prop.position.z = -L * 0.5 - (glider ? 0.0 : 0.03);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 12), lam(0xdddddd));
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.025; prop.add(spinner);
  const bladeLen = glider ? 0.22 : 0.27;
  prop.add(box(bladeLen, 0.025, 0.008, dark));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(bladeLen / 2, 24), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  g.add(prop);
  const discHolder = new THREE.Group(); discHolder.position.copy(prop.position); discHolder.add(disc); g.add(discHolder);

  // 起落架
  const wheelG = new THREE.CylinderGeometry(0.04, 0.04, 0.025, 14); wheelG.rotateZ(Math.PI / 2);
  const wheel = (x, y, z) => { const m = new THREE.Mesh(wheelG, dark); m.position.set(x, y, z); g.add(m); };
  if (!glider) {
    for (const s of [1, -1]) {
      const strut = box(0.01, 0.11, 0.015, lam(0x999999), s * 0.09, -0.08, -0.08);
      strut.rotation.z = -s * 0.5; g.add(strut);
      wheel(s * 0.12, -0.1, -0.08);
    }
    g.add(box(0.01, 0.1, 0.012, lam(0x999999), 0, -0.08, -L * 0.4));
    wheel(0, -0.1, -L * 0.4);
  } else {
    wheel(0, -0.1, -0.05);
    g.add(box(0.02, 0.03, 0.25, dark, 0, -0.07, -L * 0.3));
  }

  g.traverse(o => { if (o.isMesh) o.castShadow = false; });

  return {
    group: g, prop, disc,
    update(ctrl, rpm, dt) {
      const k = 0.45;
      ail.R.rotation.x = -ctrl.ail * k;
      ail.L.rotation.x = ctrl.ail * k;
      elev.rotation.x = -ctrl.ele * k;
      rud.rotation.y = ctrl.rud * k;
      prop.rotation.z += rpm * dt;
      disc.material.opacity = Math.min(0.35, Math.max(0, (rpm - 20) / 60));
      prop.children[1].visible = rpm < 45;
    },
  };
}
