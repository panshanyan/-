// 場景：天空、地形、跑道、樹木、雲、機棚、風向袋
import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

export const RUNWAY = { length: 140, width: 12 };
export const PILOT = new THREE.Vector3(16, 1.7, 22);

export function buildWorld(scene, quality) {
  const SKY_TOP = new THREE.Color(0x3d7fd6), HORIZON = new THREE.Color(0xcfe3f2);
  scene.fog = new THREE.Fog(HORIZON, 350, 3200);
  scene.background = HORIZON;

  // 天空漸層
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP }, hor: { value: HORIZON } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vp; void main(){ float h = max(vp.y,0.); gl_FragColor = vec4(mix(hor, top, pow(h, .55)), 1.); }',
    }));
  sky.renderOrder = -1;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(-300, 500, 200);
  scene.add(sun);

  // 草地紋理
  const grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#5f8f3a'; g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 9000; i++) {
      const v = 70 + r() * 70;
      g.fillStyle = `rgba(${v * 0.6 | 0},${v | 0},${v * 0.35 | 0},0.35)`;
      g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
  }, 1);
  grass.repeat.set(400, 400);

  // 地形
  const SIZE = 6000, SEG = quality > 0 ? 220 : 140;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = [];
  const cGrass = new THREE.Color(0xffffff), cHill = new THREE.Color(0xb9c79a), cRock = new THREE.Color(0x9a9286);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = terrainHeight(x, z);
    pos.setY(i, y);
    const c = cGrass.clone().lerp(cHill, Math.min(1, y / 40)).lerp(cRock, Math.min(1, Math.max(0, (y - 70) / 90)));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grass, vertexColors: true })));

  // 修剪過的草坪條紋
  const mown = canvasTex(64, 512, (g, w, h) => {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#7fb04d' : '#6c9c40'; g.fillRect(0, i * h / 16, w, h / 16); }
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(90, 260), new THREE.MeshLambertMaterial({ map: mown, transparent: true, opacity: 0.75 }));
  field.rotation.x = -Math.PI / 2; field.position.y = 0.02;
  scene.add(field);

  // 跑道
  const rwTex = canvasTex(256, 2048, (g, w, h) => {
    g.fillStyle = '#4b4e52'; g.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let i = 0; i < 20000; i++) { const v = 60 + r() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},0.3)`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.fillStyle = '#f2f2f2';
    for (let y = 220; y < h - 220; y += 90) g.fillRect(w / 2 - 4, y, 8, 50);
    for (const y0 of [30, h - 130]) for (let i = 0; i < 8; i++) g.fillRect(18 + i * 29, y0, 14, 100);
    g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
    g.font = 'bold 80px sans-serif'; g.textAlign = 'center';
    g.save(); g.translate(w / 2, h - 160); g.fillText('36', 0, 0); g.restore();
    g.save(); g.translate(w / 2, 160); g.rotate(Math.PI); g.fillText('18', 0, 0); g.restore();
  });
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length), new THREE.MeshLambertMaterial({ map: rwTex }));
  runway.rotation.x = -Math.PI / 2; runway.position.y = 0.04;
  scene.add(runway);

  // 機棚與飛行站
  const hangar = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 12), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
  body.position.y = 3; hangar.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 14.2, 16, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8d3b2f, side: THREE.DoubleSide }));
  roof.rotation.z = Math.PI / 2; roof.scale.set(0.35, 1, 1); roof.position.y = 6;
  hangar.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshLambertMaterial({ color: 0x37474f }));
  door.position.set(-7.01, 2.5, 0); door.rotation.y = -Math.PI / 2; hangar.add(door);
  hangar.position.set(48, 0, -10);
  scene.add(hangar);

  // 飛行員站位：遮陽棚 + 桌子
  const tent = new THREE.Mesh(new THREE.ConeGeometry(3, 1.4, 4), new THREE.MeshLambertMaterial({ color: 0x1e88e5 }));
  tent.position.set(PILOT.x + 3, 2.9, PILOT.z + 2); tent.rotation.y = Math.PI / 4; scene.add(tent);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    p.position.set(PILOT.x + 3 + dx, 1.15, PILOT.z + 2 + dz); scene.add(p);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.9), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
  table.position.set(PILOT.x + 3, 0.8, PILOT.z + 2); scene.add(table);

  // 風向袋
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  sockPole.position.set(-14, 3, -30); scene.add(sockPole);
  const sock = new THREE.Group();
  const sockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.45, 2.2, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6d00, side: THREE.DoubleSide }));
  sockMesh.rotation.x = Math.PI / 2; sockMesh.position.z = 1.1;
  sock.add(sockMesh); sock.position.set(-14, 5.8, -30); scene.add(sock);

  // 樹木（InstancedMesh）
  const trees = [];
  const r = rng(42);
  const N = quality > 0 ? 700 : 350;
  while (trees.length < N) {
    const a = r() * Math.PI * 2, d = 70 + Math.pow(r(), 0.7) * 1100;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) < 55 && Math.abs(z) < 160) continue;
    if (Math.hypot(x - 48, z + 10) < 20) continue;
    const s = 0.7 + r() * 0.9;
    trees.push({ x, z, y: terrainHeight(x, z), h: 9 * s, s });
  }
  const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6); trunkG.translate(0, 1.25, 0);
  const leafG = new THREE.ConeGeometry(2.4, 7.5, 8); leafG.translate(0, 5.5, 0);
  const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), N);
  const leaf = new THREE.InstancedMesh(leafG, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  trees.forEach((t, i) => {
    m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z);
    trunk.setMatrixAt(i, m); leaf.setMatrixAt(i, m);
    c.setHSL(0.27 + r() * 0.08, 0.45 + r() * 0.2, 0.22 + r() * 0.1);
    leaf.setColorAt(i, c);
  });
  scene.add(trunk, leaf);

  // 雲
  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    const rr = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.2 + rr() * 0.6), y = h * (0.45 + rr() * 0.25), rad = 20 + rr() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  });
  const cm = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: true });
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(cm);
    const a = r() * 7, d = 400 + r() * 2200;
    s.position.set(Math.cos(a) * d, 260 + r() * 260, Math.sin(a) * d);
    s.scale.set(260 + r() * 240, 120 + r() * 60, 1);
    scene.add(s);
  }

  return { trees, sock };
}
