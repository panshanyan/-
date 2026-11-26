// 精緻版上單翼練習機（1220 mm 翼展級距、全長約 0.95 m）
// 座艙式機身（放樣曲面）、窗戶、翼型主翼＋圓翼尖、V 形翼撐、鋼絲主起落架、前輪、背鰭、10 吋雙葉槳
// 塗裝為原創設計，可選主色
import * as THREE from 'three';

export const PAINTS = {
  yellow: { name: '黃', c: 0xf4b41a },
  red: { name: '紅', c: 0xd8322b },
  green: { name: '綠', c: 0x2f9e57 },
  blue: { name: '藍', c: 0x1f6fd1 },
  orange: { name: '橘', c: 0xff7a1a },
};

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.05, ...o });

// 超橢圓剖面放樣：sections = [z, 寬, 高, 中心 y, 方正度 n]；theta 範圍可只做部分（色帶）
function loft(sections, M = 32, t0 = 0, t1 = Math.PI * 2, grow = 1, caps = true) {
  const pos = [], idx = [];
  const ring = (s) => {
    const [z, w, h, yc, n] = s, out = [];
    for (let j = 0; j <= M; j++) {
      const t = t0 + (t1 - t0) * j / M, c = Math.cos(t), sn = Math.sin(t);
      out.push([Math.sign(c) * Math.abs(c) ** (2 / n) * w / 2 * grow, yc + Math.sign(sn) * Math.abs(sn) ** (2 / n) * h / 2 * grow, z]);
    }
    return out;
  };
  const rings = sections.map(ring);
  rings.forEach(r => r.forEach(p => pos.push(...p)));
  const R = M + 1;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  if (caps) for (const [i, flip] of [[0, true], [rings.length - 1, false]]) {
    const s = sections[i], ci = pos.length / 3;
    pos.push(0, s[3], s[0]);
    for (let j = 0; j < M; j++) { const a = i * R + j, b = a + 1; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 翼型（平凸翼）沿 +X 擠出，前緣朝 -Z、原點在前緣
function wingPanel(chord, span, thick = 0.12) {
  const s = new THREE.Shape(), N = 20, up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const u = (1 - Math.cos(Math.PI * i / N)) / 2;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    up.push([-u * chord, yt * 1.55]); lo.push([-u * chord, -yt * 0.2]);
  }
  s.moveTo(...up[0]); for (let i = 1; i <= N; i++) s.lineTo(...up[i]);
  for (let i = N; i >= 0; i--) s.lineTo(...lo[i]);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false });
  g.rotateY(Math.PI / 2); // 剖面 x(-弦向) → +Z（後緣朝後）
  g.computeVertexNormals();
  return g;
}
// 圓翼尖：剖面沿翼展縮小
function wingTip(chord, len, thick = 0.12) {
  const g = wingPanel(chord, len, thick), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / len, k = Math.sqrt(Math.max(0.02, 1 - t * t));
    p.setZ(i, (p.getZ(i) - chord * 0.35) * k + chord * 0.35 * k + chord * 0.0);
    p.setY(i, p.getY(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
function plate(points, thick, m) { // 平板外形（尾翼）：points 為 [x, z]，水平放置
  const s = new THREE.Shape(); s.moveTo(points[0][0], points[0][1]); points.slice(1).forEach(p => s.lineTo(p[0], p[1]));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: thick * 0.45, bevelSegments: 2 });
  g.rotateX(Math.PI / 2); g.translate(0, thick / 2, 0);
  g.computeVertexNormals();
  return new THREE.Mesh(g, m);
}
function rod(a, b, r, m) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, L, 8);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return mesh;
}
function textTex(text, color, w = 512, h = 128, font = 'bold') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = `${font} ${h * 0.66}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function decal(tex, w, h, m4) {
  const d = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
  d.applyMatrix4(m4); return d;
}

// 用 Catmull-Rom 把剖面站位加密，機身更圓滑
function smooth(S, per = 4) {
  const out = [];
  for (let i = 0; i < S.length - 1; i++) {
    const p0 = S[Math.max(0, i - 1)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(S.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(S[S.length - 1]);
  return out;
}
// 螺旋槳葉片：沿半徑漸縮、依螺距扭轉的橢圓翼剖面
function bladeGeo(r0, r1, pitch) {
  const N = 14, M = 14, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = r0 + (r1 - r0) * t;
    const chord = 0.009 + 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.12)) * (1 - 0.55 * t);
    const th = Math.atan(pitch / (2 * Math.PI * r));
    for (let j = 0; j < M; j++) {
      const a = j / M * Math.PI * 2, cy = Math.cos(a) * chord / 2, cz = Math.sin(a) * chord * 0.06;
      pos.push(r, cy * Math.cos(th) - cz * Math.sin(th), -(cy * Math.sin(th) + cz * Math.cos(th)));
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = a + M, d = b + M;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// 窗戶內裝貼圖：深色座艙、座椅與頭部剪影、玻璃反光
function windowTex(head) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#24384e'); gr.addColorStop(1, '#070b12');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#0b0f16'; g.fillRect(40, 70, 70, 58); g.fillRect(150, 70, 70, 58);
  if (head) { g.fillStyle = '#121820'; g.beginPath(); g.arc(80, 58, 22, 0, 7); g.fill(); g.fillRect(58, 74, 46, 54); }
  const rf = g.createLinearGradient(0, 0, 256, 128); rf.addColorStop(0.25, 'rgba(255,255,255,0)'); rf.addColorStop(0.4, 'rgba(255,255,255,0.28)'); rf.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = rf; g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// 機身側面面板線（艙門輪廓、把手、檢修蓋）
function panelTex() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke(); };
  rr(250, 20, 300, 210, 26);            // 艙門
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(500, 130, 30, 7); // 把手
  rr(640, 120, 120, 70, 10);            // 電池艙蓋
  for (let x = 660; x <= 740; x += 20) { g.beginPath(); g.arc(x, 130, 2.5, 0, 7); g.fill(); }
  g.beginPath(); g.moveTo(60, 60); g.lineTo(60, 230); g.stroke(); // 機頭罩接縫
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function buildTrainer(paintKey = 'yellow') {
  const g = new THREE.Group();
  const P = (PAINTS[paintKey] || PAINTS.yellow).c;
  const coat = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const white = coat(0xf7f7f4), prim = coat(P), navy = coat(0x1d2c5c), dark = mat(0x161616, { roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1a2a, roughness: 0.03, metalness: 0.95, envMapIntensity: 1.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });

  // ---- 機身（放樣）----
  const S = [
    [-0.445, 0.090, 0.090, -0.012, 2.2],
    [-0.420, 0.118, 0.122, -0.006, 2.5],
    [-0.360, 0.128, 0.140, 0.004, 2.9],
    [-0.300, 0.130, 0.140, 0.004, 3.1],
    [-0.220, 0.130, 0.170, 0.022, 3.3],
    [-0.140, 0.126, 0.182, 0.026, 3.5],
    [-0.040, 0.120, 0.176, 0.026, 3.4],
    [0.050, 0.110, 0.150, 0.030, 3.2],
    [0.150, 0.088, 0.112, 0.036, 2.9],
    [0.260, 0.064, 0.082, 0.042, 2.6],
    [0.370, 0.046, 0.060, 0.046, 2.4],
    [0.465, 0.026, 0.040, 0.050, 2.2],
  ];
  const SS = smooth(S, 4);
  const fus = new THREE.Mesh(loft(SS, 48), white); g.add(fus);
  // 機腹色帶（主色）＋細線（深藍）
  g.add(new THREE.Mesh(loft(SS.slice(8), 40, Math.PI * 1.12, Math.PI * 1.88, 1.006, false), prim));
  const pin = (t0, t1) => new THREE.Mesh(loft(SS.slice(8, 37), 6, t0, t1, 1.008, false), navy);
  g.add(pin(Math.PI * 1.06, Math.PI * 1.1), pin(Math.PI * 1.9, Math.PI * 1.94));
  // 機頭罩（主色）
  g.add(new THREE.Mesh(loft(SS.slice(0, 9), 48, 0, Math.PI * 2, 1.01, false), prim));
  // 機頭罩前緣環、散熱槽、馬達固定螺絲
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.004, 8, 32), dark); ring.position.set(0, -0.012, -0.444); g.add(ring);
  for (let i = 0; i < 4; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.03), dark); sl.position.set(-0.024 + i * 0.016, -0.074, -0.4); g.add(sl); }
  // 機身側面面板線
  const pt = panelTex();
  for (const sx of [-1, 1]) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    pm.position.set(sx * 0.0655, 0.01, -0.14); pm.rotation.y = sx * Math.PI / 2; if (sx < 0) pm.scale.x = -1; g.add(pm);
  }
  // 散熱進氣口
  for (const sx of [-1, 1]) {
    const inlet = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), dark);
    inlet.scale.set(1, 0.6, 1); inlet.position.set(sx * 0.034, -0.03, -0.432); inlet.rotation.y = Math.PI; g.add(inlet);
  }

  // ---- 窗戶 ----
  const winShape = (w, h, r) => { const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return new THREE.ShapeGeometry(s, 6); };
  const winT = [windowTex(false), windowTex(true)];
  for (const sx of [-1, 1]) {
    for (const [z, w] of [[-0.175, 0.075], [-0.085, 0.085], [0.01, 0.06]]) {
      const wg = new THREE.Mesh(winShape(w, 0.062, 0.012), new THREE.MeshPhysicalMaterial({ map: winT[z < -0.1 ? 1 : 0], roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 }));
      wg.geometry.computeBoundingBox(); { const uv = wg.geometry.attributes.uv, p = wg.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) / w + 0.5) * (sx > 0 ? 1 : -1) + (sx > 0 ? 0 : 1), p.getY(i) / 0.062 + 0.5); }
      wg.position.set(sx * 0.0632, 0.066, z); wg.rotation.y = sx * Math.PI / 2; g.add(wg);
    }
  }
  // 擋風玻璃：貼合機身上方的曲面
  g.add(new THREE.Mesh(loft(SS.slice(12, 20), 32, Math.PI * 0.2, Math.PI * 0.8, 1.01, false), glass));
  g.add(new THREE.Mesh(loft(SS.slice(12, 13).concat([SS[12].map((v, j) => j === 0 ? v + 0.006 : v)]), 32, Math.PI * 0.17, Math.PI * 0.83, 1.016, false), white));

  // ---- 主翼 ----
  const chord = 0.208, half = 0.61, wingY = 0.117, wingZ = -0.15;
  const dih = 2.5 * Math.PI / 180;
  const ail = {};
  const centerPanel = new THREE.Mesh(wingPanel(chord, 0.13), white);
  centerPanel.position.set(-0.065, wingY, wingZ); g.add(centerPanel);
  for (const side of [1, -1]) {
    const h = new THREE.Group();
    h.position.set(side * 0.065, wingY, wingZ);
    h.rotation.z = side * dih; h.scale.x = side;
    const inner = half - 0.065 - 0.07;
    h.add(new THREE.Mesh(wingPanel(chord, inner * 0.62), white));
    const outer = new THREE.Mesh(wingPanel(chord, inner * 0.38), prim); outer.position.x = inner * 0.62; h.add(outer);
    const tip = new THREE.Mesh(wingTip(chord, 0.07), prim); tip.position.x = inner; h.add(tip);
    // 翼面深藍細線
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, chord * 0.86), navy); pl.position.set(inner * 0.62 - 0.008, chord * 0.12 * 0.62, chord * 0.48); h.add(pl);
    // 副翼、襟翼（鉸鏈線）
    const ac = chord * 0.24;
    const a = new THREE.Group(); a.position.set(inner * 0.5, 0.0, chord - ac);
    const am = new THREE.Mesh(new THREE.BoxGeometry(inner * 0.46, 0.009, ac), prim); am.position.set(inner * 0.23, 0.0035, ac / 2); a.add(am);
    h.add(a); ail[side > 0 ? 'R' : 'L'] = a;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(inner * 0.44, 0.008, ac), white); flap.position.set(inner * 0.24, 0.0035, chord - ac / 2 + 0.001); h.add(flap);
    const gap = new THREE.Mesh(new THREE.BoxGeometry(inner * 0.92, 0.0095, 0.002), dark); gap.position.set(inner * 0.47, 0.0035, chord - ac); h.add(gap);
    // 翼尖航行燈（右綠左紅）
    const nl = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshStandardMaterial({ color: side > 0 ? 0x22ff66 : 0xff2a2a, emissive: side > 0 ? 0x22ff66 : 0xff2a2a, emissiveIntensity: 1.6 }));
    nl.position.set(inner + 0.055, 0.012, chord * 0.18); h.add(nl);
    // 副翼舵角
    const horn = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.02, 0.014), dark); horn.position.set(inner * 0.08, -0.008, 0.006); a.add(horn);
    g.add(h);
    // 翼撐固定座
    for (const dz of [0.04, 0.15]) { const ft = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.014), steel); ft.position.set(side * 0.33, wingY - 0.004 + Math.sin(dih) * 0.33, wingZ + dz); g.add(ft); }
    // V 形翼撐
    const attach = [side * 0.055, -0.045, -0.105];
    g.add(rod(attach, [side * 0.33, wingY - 0.003 + Math.sin(dih) * 0.33, wingZ + 0.04], 0.0045, steel));
    g.add(rod(attach, [side * 0.33, wingY - 0.003 + Math.sin(dih) * 0.33, wingZ + 0.15], 0.0045, steel));
  }

  // ---- 尾翼 ----
  const tz = 0.36, ty = 0.052;
  for (const side of [1, -1]) {
    const hs = plate([[0, 0], [0.23, 0.025], [0.23, 0.1], [0, 0.125]], 0.006, white);
    hs.position.set(0.0, ty, tz); hs.scale.x = side; g.add(hs);
  }
  const elev = new THREE.Group(); elev.position.set(0, ty + 0.003, tz + 0.125);
  const eg = plate([[-0.23, 0], [0.23, 0], [0.22, 0.05], [-0.22, 0.05]], 0.005, prim); elev.add(eg); g.add(elev);
  // 垂直尾翼（含背鰭）
  const finS = new THREE.Shape(); finS.moveTo(0, 0); finS.lineTo(0.16, 0); finS.lineTo(0.15, 0.165); finS.lineTo(0.09, 0.165); finS.lineTo(-0.11, 0.012); finS.lineTo(-0.11, 0); finS.lineTo(0, 0);
  const fg = new THREE.ExtrudeGeometry(finS, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
  fg.rotateY(-Math.PI / 2); fg.translate(0.003, 0, 0);
  const fin = new THREE.Mesh(fg, prim); fin.position.set(0, 0.07, tz - 0.03); g.add(fin);
  const rud = new THREE.Group();
  const rs = new THREE.Shape(); rs.moveTo(0, 0); rs.lineTo(0.055, 0.0); rs.lineTo(0.05, 0.16); rs.lineTo(0, 0.165);
  const rg = new THREE.ExtrudeGeometry(rs, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  rg.rotateY(-Math.PI / 2); rg.translate(0.0025, 0, 0);
  const rm = new THREE.Mesh(rg, white); rud.add(rm);
  rud.position.set(0, 0.07, tz + 0.13); g.add(rud);
  const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.018, 0.05), navy); stripeR.position.set(0, 0.1, 0.027); rud.add(stripeR);
  // 舵角與連桿（升降舵在左、方向舵在右）
  const eh = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.022, 0.016), dark); eh.position.set(-0.03, -0.012, 0.008); elev.add(eh);
  const rh = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.003, 0.016), dark); rh.position.set(0.012, 0.01, 0.008); rud.add(rh);
  g.add(rod([-0.03, 0.035, 0.12], [-0.03, ty - 0.012, tz + 0.12], 0.0012, steel));
  g.add(rod([0.026, 0.06, 0.12], [0.02, 0.08, tz + 0.12], 0.0012, steel));
  // 尾燈、機背天線、防撞閃燈
  const tl = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 })); tl.position.set(0, 0.052, 0.47); g.add(tl);
  g.add(rod([0, 0.1, 0.12], [0, 0.17, 0.16], 0.0012, dark));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 0 }));
  beacon.position.set(0, 0.103, 0.06); g.add(beacon);

  // ---- 螺旋槳（10 吋）＋整流罩 ----
  const prop = new THREE.Group(); prop.position.set(0, -0.006, -0.452);
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.028, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), white);
  spinner.scale.set(1, 1, 1.6); spinner.rotation.x = -Math.PI / 2; prop.add(spinner);
  const blades = new THREE.Group();
  const bg = bladeGeo(0.016, 0.127, 0.127);
  const propM = new THREE.MeshPhysicalMaterial({ color: 0x1a1a1a, roughness: 0.35, clearcoat: 0.6 });
  for (const sgn of [0, 1]) { const bl = new THREE.Mesh(bg, propM); bl.rotation.z = sgn * Math.PI; blades.add(bl); }
  const hubC = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), propM); hubC.rotation.x = Math.PI / 2; blades.add(hubC);
  prop.add(blades);
  g.add(prop);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.127, 40), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.copy(prop.position); g.add(disc);

  // ---- 起落架 ----
  const wheel = (x, y, z, r) => {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 12, 28), rubber); tire.rotation.y = Math.PI / 2; tire.position.set(x, y, z); g.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 0.5, 18), mat(0xf2f2f2)); hub.rotation.z = Math.PI / 2; hub.position.set(x, y, z); g.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, r * 0.62, 12), steel); cap.rotation.z = Math.PI / 2; cap.position.set(x, y, z); g.add(cap);
    for (const sx of [-1, 1]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.5, r * 0.05, 6, 24), mat(0xcfcfcf)); rim.rotation.y = Math.PI / 2; rim.position.set(x + sx * r * 0.26, y, z); g.add(rim); }
    for (const sx of [-1, 1]) { const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.12, 10), steel); col.rotation.z = Math.PI / 2; col.position.set(x + sx * r * 0.42, y, z); g.add(col); }
  };
  const wr = 0.036;
  for (const s of [1, -1]) {
    g.add(rod([s * 0.02, -0.07, -0.03], [s * 0.125, -0.105, -0.035], 0.003, steel));
    wheel(s * 0.135, -0.14 + wr, -0.035, wr);
  }
  g.add(rod([0, -0.05, -0.385], [0, -0.115, -0.39], 0.0035, steel));
  g.add(rod([0.012, -0.11, -0.39], [0.012, -0.14 + 0.03, -0.39], 0.002, steel), rod([-0.012, -0.11, -0.39], [-0.012, -0.14 + 0.03, -0.39], 0.002, steel));
  wheel(0, -0.14 + 0.03, -0.39, 0.03);

  // ---- 標誌（原創）----
  const reg = textTex('B-YN48', '#1d2c5c');
  for (const sx of [-1, 1]) {
    const m4 = new THREE.Matrix4().makeRotationY(sx * Math.PI / 2).setPosition(sx * 0.0472, 0.04, 0.19);
    g.add(decal(reg, 0.13, 0.032, m4));
  }
  const nameT = textTex('ynfly_fpv', '#ffffff');
  for (const sx of [-1, 1]) {
    const m4 = new THREE.Matrix4().makeRotationY(sx * Math.PI / 2).setPosition(sx * 0.0045, 0.17, tz + 0.03);
    g.add(decal(nameT, 0.12, 0.03, m4));
  }
  const wingName = textTex('ynfly', '#1d2c5c', 512, 128, '900 italic');
  const wm = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).setPosition(-0.3, wingY + 0.032, wingZ + chord * 0.45);
  g.add(decal(wingName, 0.22, 0.06, wm));

  g.traverse(o => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    group: g, prop, disc,
    update(ctrl, rpm, dt) {
      const k = 0.42;
      ail.R.rotation.x = -ctrl.ail * k;
      ail.L.rotation.x = ctrl.ail * k;
      elev.rotation.x = -ctrl.ele * k;
      rud.rotation.y = ctrl.rud * k;
      prop.rotation.z += rpm * dt;
      this.t = (this.t || 0) + dt; beacon.material.emissiveIntensity = (this.t % 1.2) < 0.12 ? 3 : 0;
      disc.material.opacity = Math.min(0.28, Math.max(0, (rpm - 20) / 60));
      blades.visible = rpm < 45;
    },
  };
}
