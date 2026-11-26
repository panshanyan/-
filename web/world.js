// 場景：天空、地形、跑道、滑行道、樹木、池塘、雲、機棚、飛行員區、風向袋
import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
// 平滑值雜訊（地面色塊用）
function vnoise(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}
const fbm = (x, z) => vnoise(x, z) * 0.55 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.15;

export const RUNWAY = { length: 140, width: 12 };
export const PILOT = new THREE.Vector3(16, 1.7, 0);
export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
export const POND = { x: -190, z: 110, r: 38 };

export function buildWorld(scene, renderer, quality) {
  const hi = quality > 0;
  const SKY_TOP = new THREE.Color(0x2f6fc8), HORIZON = new THREE.Color(0xd6e6f2);
  scene.fog = new THREE.Fog(0xc9dcea, 400, 3400);
  scene.background = HORIZON;

  // 天空：漸層 + 太陽光暈
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, hor: { value: HORIZON }, sun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vp;
      void main(){
        float h = max(vp.y, 0.);
        vec3 c = mix(hor, top, pow(h, .5));
        c = mix(c, vec3(.78,.84,.88), smoothstep(.0,-.08, vp.y));
        float s = max(dot(normalize(vp), sun), 0.);
        c += vec3(1.,.9,.7) * (pow(s, 600.) * 4. + pow(s, 12.) * .25 + pow(s, 3.) * .06);
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(4500, 40, 20), skyMat));

  // 環境反射（給飛機烤漆、池塘用）
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(99, 32), new THREE.MeshBasicMaterial({ color: 0x4f6b38 }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -5; envScene.add(gnd);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x56703a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  if (hi) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -9; sc.right = sc.top = 9; sc.near = 1; sc.far = 1200;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun, sun.target);

  // 草地紋理（多層色塊 + 草葉細節）
  const grass = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#5c8a38'; g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.5 ? '70,110,40' : '110,140,55';
      gr.addColorStop(0, `rgba(${tone},0.25)`); gr.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 60000; i++) {
      const v = 60 + r() * 90;
      g.fillStyle = `rgba(${v * 0.6 | 0},${v | 0},${v * 0.32 | 0},${0.25 + r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 2 + r() * 4);
    }
  }, 1);
  grass.repeat.set(700, 700);

  // 地形：色塊（深淺草地、乾草地）+ 高度變色
  const SIZE = 7000, SEG = hi ? 260 : 150;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = [];
  const cA = new THREE.Color(0xffffff), cB = new THREE.Color(0xdde8a4), cC = new THREE.Color(0x9cbd84),
    cHill = new THREE.Color(0xa9bc8c), cRock = new THREE.Color(0x9b958a), cSnow = new THREE.Color(0xf2f4f6);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = terrainHeight(x, z);
    pos.setY(i, y);
    const n = fbm(x / 160, z / 160);
    c.copy(cA).lerp(n > 0.55 ? cB : cC, Math.min(1, Math.abs(n - 0.55) * 3));
    c.lerp(cHill, Math.min(1, y / 50)).lerp(cRock, Math.min(1, Math.max(0, (y - 90) / 80))).lerp(cSnow, Math.min(1, Math.max(0, (y - 230) / 60)));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grass, vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const flat = (w, l, mat, x, z, y = 0.02, rot = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, y, z); m.receiveShadow = true;
    scene.add(m); return m;
  };

  // 修剪過的草坪條紋
  const mown = canvasTex(64, 1024, (g, w, h) => {
    for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? '#86b552' : '#73a345'; g.fillRect(0, i * h / 24, w, h / 24); }
    const r = rng(5);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(40,70,20,${r() * 0.15})`; g.fillRect(r() * w, r() * h, 1, 3); }
  });
  flat(100, 300, new THREE.MeshLambertMaterial({ map: mown, transparent: true, opacity: 0.8 }), 0, 0, 0.02);

  // 跑道
  const asphalt = (g, w, h, seed) => {
    g.fillStyle = '#45484c'; g.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < w * h / 12; i++) { const v = 50 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,20,22,${0.05 + r() * 0.1})`; g.fillRect(r() * w, r() * h, 4 + r() * 30, 40 + r() * 200); }
  };
  const rwTex = canvasTex(512, 4096, (g, w, h) => {
    asphalt(g, w, h, 3);
    g.fillStyle = '#f4f4f0';
    for (let y = 420; y < h - 420; y += 180) g.fillRect(w / 2 - 6, y, 12, 100);
    for (const y0 of [50, h - 250]) for (let i = 0; i < 8; i++) g.fillRect(36 + i * 58, y0, 26, 200);
    g.fillRect(14, 0, 10, h); g.fillRect(w - 24, 0, 10, h);
    for (const y0 of [700, h - 900]) { g.fillRect(140, y0, 40, 200); g.fillRect(w - 180, y0, 40, 200); }
    g.font = 'bold 170px sans-serif'; g.textAlign = 'center';
    g.save(); g.translate(w / 2, h - 300); g.fillText('36', 0, 0); g.restore();
    g.save(); g.translate(w / 2, 300); g.rotate(Math.PI); g.fillText('18', 0, 0); g.restore();
    const r = rng(8);
    g.fillStyle = 'rgba(25,25,25,0.25)';
    for (let i = 0; i < 30; i++) g.fillRect(w / 2 - 40 + r() * 80, 600 + r() * 900, 8, 120);
  });
  flat(RUNWAY.width, RUNWAY.length, new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.92 }), 0, 0, 0.04);
  // 滑行道 + 停機坪
  const twTex = canvasTex(128, 512, (g, w, h) => { asphalt(g, w, h, 9); g.fillStyle = '#e8c01c'; g.fillRect(w / 2 - 3, 0, 6, h); });
  flat(5, 34, new THREE.MeshStandardMaterial({ map: twTex, roughness: 0.92 }), 23, -10, 0.035, Math.PI / 2);
  const apTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a9a96'; g.fillRect(0, 0, w, h);
    const r = rng(4); for (let i = 0; i < 9000; i++) { const v = 130 + r() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},0.3)`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
  });
  flat(26, 30, new THREE.MeshStandardMaterial({ map: apTex, roughness: 0.95 }), 52, -10, 0.03);

  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
  // 跑道邊燈
  const lampG = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6); lampG.translate(0, 0.15, 0);
  const lamps = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2b0, emissiveIntensity: 0.6 }), 32);
  let li = 0; const m4 = new THREE.Matrix4();
  for (let z = -70; z <= 70.1; z += 20) for (const x of [-7, 7]) { m4.makeTranslation(x, 0, z); lamps.setMatrixAt(li++, m4); }
  for (const x of [-4, -1.5, 1.5, 4]) { m4.makeTranslation(x, 0, 71.5); lamps.setMatrixAt(li++, m4); m4.makeTranslation(x, 0, -71.5); lamps.setMatrixAt(li++, m4); }
  lamps.count = li; scene.add(lamps);

  // 術科場地標線：中線（飛手正前方）、兩端起飛線（距中線 30 m）、4 m 寬主輪範圍線
  const lineM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const laneM = new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true, opacity: 0.8 });
  flat(RUNWAY.width, 0.35, new THREE.MeshBasicMaterial({ color: 0xff4d3a, transparent: true, opacity: 0.85 }), 0, PILOT.z, 0.05);
  for (const s of [-1, 1]) flat(RUNWAY.width, 0.3, lineM, 0, PILOT.z + s * 30, 0.05);
  for (const s of [-1, 1]) for (let z = -68; z < 68; z += 6) flat(0.12, 3, laneM, s * 2, z + 1.5, 0.05);
  // 8 字交叉點 P5 角錐
  const coneM = std(0xff6d00);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 14), coneM); cone.position.set(PILOT.x - 50, 0.4, PILOT.z); scene.add(cone);

  // 機棚
  const shed = (obj) => { obj.traverse(o => { if (o.isMesh) { o.castShadow = hi; o.receiveShadow = true; } }); return obj; };
  const hangar = new THREE.Group();
  const wallTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#c4ccd2'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'; g.fillRect(x, 0, 4, h); }
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 12), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, metalness: 0.3 }));
  body.position.y = 3; hangar.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 14.4, 24, 1, false, 0, Math.PI), std(0x9e3b2c, { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.5 }));
  roof.rotation.z = Math.PI / 2; roof.scale.set(0.35, 1, 1); roof.position.y = 6; hangar.add(roof);
  const doorTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#3a4650'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 2, h); }
    g.fillStyle = '#f4c20d'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText('RC CLUB', w / 2, 40);
  });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.2 }));
  door.position.set(-7.01, 2.5, 0); door.rotation.y = -Math.PI / 2; hangar.add(door);
  hangar.position.set(52, 0, -10);
  scene.add(shed(hangar));

  // 飛行員區：遮陽棚、桌子、圍欄、旗子
  const pilotArea = new THREE.Group();
  const canopyT = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.3, 4, 1, true), std(0x1e88e5, { side: THREE.DoubleSide }));
  canopyT.position.set(3, 2.9, 2); canopyT.rotation.y = Math.PI / 4; pilotArea.add(canopyT);
  for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3), std(0xdddddd, { metalness: 0.7, roughness: 0.3 }));
    p.position.set(3 + dx, 1.15, 2 + dz); pilotArea.add(p);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.9), std(0xf0f0f0));
  table.position.set(3, 0.78, 2); pilotArea.add(table);
  for (const s of [-0.8, 0.8]) for (const t of [-0.35, 0.35]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.76), std(0x777777)); leg.position.set(3 + s, 0.38, 2 + t); pilotArea.add(leg);
  }
  // 飛行員區後方圍欄（不擋視線）
  const railM = std(0xfafafa);
  for (let z = -10; z <= 14; z += 3) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), railM); post.position.set(7, 0.55, z); pilotArea.add(post);
  }
  for (const y of [0.5, 1.0]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 24), railM); rail.position.set(7, y, 2); pilotArea.add(rail); }
  for (const [fz, colr] of [[-9, 0xff5722], [13, 0x29b6f6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5), std(0xcccccc, { metalness: 0.6, roughness: 0.3 }));
    pole.position.set(6, 2.5, fz); pilotArea.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.2), std(colr, { side: THREE.DoubleSide }));
    fl.position.set(6, 3.8, fz + 0.35); fl.rotation.y = Math.PI / 2; pilotArea.add(fl);
  }
  pilotArea.position.set(PILOT.x, 0, PILOT.z);
  scene.add(shed(pilotArea));

  // 風向袋
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6), std(0xdddddd, { metalness: 0.6, roughness: 0.3 }));
  sockPole.position.set(-14, 3, -30); scene.add(shed(sockPole));
  const sock = new THREE.Group();
  const sockTex = canvasTex(8, 64, (g, w, h) => { for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff5a12'; g.fillRect(0, i * h / 5, w, h / 5); } });
  const sockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.42, 2.2, 14, 1, true), new THREE.MeshStandardMaterial({ map: sockTex, side: THREE.DoubleSide, roughness: 0.8 }));
  sockMesh.rotation.x = Math.PI / 2; sockMesh.position.z = 1.1;
  sock.add(sockMesh); sock.position.set(-14, 5.8, -30); scene.add(sock);

  // 池塘
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 48), new THREE.MeshStandardMaterial({ color: 0x2e5e7a, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(POND.x, 0.06, POND.z); water.receiveShadow = true; scene.add(water);
  const shore = new THREE.Mesh(new THREE.RingGeometry(POND.r - 0.5, POND.r + 3, 48), new THREE.MeshLambertMaterial({ color: 0x8a7a55 }));
  shore.rotation.x = -Math.PI / 2; shore.position.set(POND.x, 0.05, POND.z); scene.add(shore);

  // 樹木：針葉樹（三層錐）＋闊葉樹（球團）
  const trees = [];
  const r = rng(42);
  const N = hi ? 900 : 380;
  const rows = [[-140, -300, -140, 300], [140, -320, 160, 280], [-300, -220, 300, -260], [-260, 260, 260, 300], [80, 120, 240, 60], [-120, -140, -260, -40]];
  while (trees.length < N) {
    let x, z;
    if (r() < 0.25) {
      const [x1, z1, x2, z2] = rows[Math.floor(r() * rows.length)], t = r();
      x = x1 + (x2 - x1) * t + (r() - 0.5) * 14; z = z1 + (z2 - z1) * t + (r() - 0.5) * 14;
    } else {
      const a = r() * Math.PI * 2, d = 90 + Math.pow(r(), 0.75) * 1300;
      x = Math.cos(a) * d; z = Math.sin(a) * d;
    }
    if (Math.abs(x) < 60 && Math.abs(z) < 170) continue;
    if (Math.hypot(x - 52, z + 10) < 24) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 6) continue;
    const s = 0.7 + r() * 0.8;
    const type = r() < 0.55 ? 0 : 1;
    trees.push({ x, z, y: terrainHeight(x, z), h: (type ? 8 : 11) * s, s, type, rot: r() * 6.28 });
  }
  const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 3, 6); trunkG.translate(0, 1.5, 0);
  const pineG = mergeGeos([[2.5, 4.2, 3.6], [2.0, 3.6, 5.6], [1.35, 3.0, 7.6]].map(([rad, h, y]) => { const g = new THREE.ConeGeometry(rad, h, 9); g.translate(0, y, 0); return g; }));
  const leafyG = mergeGeos([[0, 4.6, 0, 2.3], [1.1, 4.1, 0.6, 1.7], [-1.0, 4.2, -0.5, 1.8], [0.2, 5.9, -0.3, 1.6], [-0.4, 4.0, 1.1, 1.5]].map(([x, y, z, rad]) => { const g = new THREE.IcosahedronGeometry(rad, 1); g.translate(x, y, z); return g; }));
  const nP = trees.filter(t => !t.type).length, nL = trees.length - nP;
  const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x5d4334 }), trees.length);
  const pine = new THREE.InstancedMesh(pineG, new THREE.MeshLambertMaterial({ color: 0xffffff }), nP);
  const leafy = new THREE.InstancedMesh(leafyG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), nL);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), cc = new THREE.Color(), yAxis = new THREE.Vector3(0, 1, 0);
  let ip = 0, il = 0;
  trees.forEach((t, i) => {
    q.setFromAxisAngle(yAxis, t.rot);
    sc.set(t.s, t.s * (0.9 + r() * 0.25), t.s); p3.set(t.x, t.y, t.z);
    m4.compose(p3, q, sc);
    trunk.setMatrixAt(i, m4);
    if (t.type === 0) { pine.setMatrixAt(ip, m4); cc.setHSL(0.31 + r() * 0.05, 0.4 + r() * 0.15, 0.17 + r() * 0.08); pine.setColorAt(ip++, cc); }
    else { leafy.setMatrixAt(il, m4); cc.setHSL(0.22 + r() * 0.08, 0.45 + r() * 0.2, 0.24 + r() * 0.1); leafy.setColorAt(il++, cc); }
  });
  scene.add(trunk, pine, leafy);

  // 灌木
  const bushG = new THREE.IcosahedronGeometry(0.9, 1); bushG.scale(1, 0.65, 1); bushG.translate(0, 0.35, 0);
  const NB = hi ? 160 : 70;
  const bush = new THREE.InstancedMesh(bushG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), NB);
  for (let i = 0; i < NB; i++) {
    let x, z;
    do { x = (r() - 0.5) * 520; z = (r() - 0.5) * 620; } while ((Math.abs(x) < 62 && Math.abs(z) < 175) || Math.hypot(x - POND.x, z - POND.z) < POND.r + 2 || Math.hypot(x - 52, z + 10) < 22);
    const s = 0.6 + r() * 1.2;
    m4.makeScale(s, s, s).setPosition(x, 0, z);
    bush.setMatrixAt(i, m4); cc.setHSL(0.24 + r() * 0.07, 0.4, 0.22 + r() * 0.1); bush.setColorAt(i, cc);
  }
  scene.add(bush);

  // 雲：立體感（底部帶灰）
  const cloudTex = canvasTex(512, 256, (g, w, h) => {
    const rr = rng(11);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 40; i++) {
      const x = w * (0.15 + rr() * 0.7), y = h * (0.35 + rr() * 0.35) + (pass ? -8 : 10), rad = 30 + rr() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const colr = pass ? '255,255,255' : '190,198,212';
      gr.addColorStop(0, `rgba(${colr},${pass ? 0.85 : 0.6})`); gr.addColorStop(1, `rgba(${colr},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  });
  const cm = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: true });
  for (let i = 0; i < (hi ? 38 : 22); i++) {
    const s = new THREE.Sprite(cm);
    const a = r() * 7, d = 500 + r() * 2600;
    s.position.set(Math.cos(a) * d, 280 + r() * 320, Math.sin(a) * d);
    const k = 0.8 + r() * 1.2;
    s.scale.set(380 * k, 190 * k, 1);
    scene.add(s);
  }

  return { trees, sock, sun };
}

function mergeGeos(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
