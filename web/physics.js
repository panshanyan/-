// 簡化但具真實感的固定翼 RC 飛機物理模型
// 機身座標：前方 = -Z，上方 = +Y，右方 = +X
import { Vector3, Quaternion, Euler } from 'three';

const RHO = 1.225, G = 9.81, D2R = Math.PI / 180;

export const PLANES = {
  trainer: {
    name: '練習機', mass: 1.4, S: 0.32, span: 1.4, length: 1.1,
    CL0: 0.28, CLa: 4.8, trimA: 0.5, stall: 14, CD0: 0.04, k: 0.06,
    thrust: 13, vprop: 35, rates: [150, 180, 90], vref: 14,
    stabP: 9, stabY: 6, dihedral: 3.0, propwash: 0.35, resp: 6,
    color: 0xffc41f, accent: 0xd32f2f, highWing: true,
  },
  sport: {
    name: '特技機', mass: 1.0, S: 0.30, span: 1.2, length: 1.15,
    CL0: 0.0, CLa: 4.5, trimA: 2.2, stall: 16, CD0: 0.05, k: 0.07,
    thrust: 17, vprop: 33, rates: [320, 420, 220], vref: 13,
    stabP: 4, stabY: 3, dihedral: 0.2, propwash: 1.1, resp: 10,
    color: 0xf5f5f5, accent: 0x1565c0, highWing: false,
  },
  glider: {
    name: '滑翔機', mass: 1.1, S: 0.36, span: 2.0, length: 1.2,
    CL0: 0.45, CLa: 5.2, trimA: 0, stall: 12, CD0: 0.022, k: 0.035,
    thrust: 7, vprop: 26, rates: [110, 110, 70], vref: 12,
    stabP: 10, stabY: 7, dihedral: 4.5, propwash: 0.25, resp: 5,
    color: 0xffffff, accent: 0xff6d00, highWing: true, glider: true,
  },
};

export class FlightModel {
  constructor(spec, terrainHeight) {
    this.spec = spec;
    this.h = terrainHeight;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.q = new Quaternion();
    this.w = new Vector3();         // 機身角速度 (rad/s): x=俯仰, y=偏航, z=滾轉
    this.wind = new Vector3();
    this.gust = 0;
    this.t = 0;
    this.gearH = 0.14;
    this.reset();
  }

  reset(x = 0, z = 40, heading = 0) {
    this.pos.set(x, this.h(x, z) + this.gearH, z);
    this.vel.set(0, 0, 0);
    this.q.setFromEuler(new Euler(0, heading, 0, 'YXZ'));
    this.w.set(0, 0, 0);
    this.onGround = true;
    this.crashed = false;
    this.crashInfo = '';
    this.airTime = 0;
    this.event = null;
    this.alpha = 0; this.airspeed = 0;
  }

  // ctrl: {thr 0..1, ail -1..1 (右=+), ele -1..1 (拉=+ 抬頭), rud -1..1 (右=+)}
  step(dt, ctrl) {
    if (this.crashed) return;
    const s = this.spec;
    this.t += dt;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.q);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.q);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.q);

    // 陣風
    const g = 1 + 0.35 * Math.sin(this.t * 0.7) * Math.sin(this.t * 1.9 + 1) * this.gust;
    const air = this.vel.clone().sub(this.wind.clone().multiplyScalar(g));
    const V = air.length();
    const vb = air.clone().applyQuaternion(this.q.clone().invert());
    const alpha = V > 0.5 ? Math.atan2(-vb.y, -vb.z) : 0;
    const beta = V > 0.5 ? Math.atan2(vb.x, -vb.z) : 0;
    this.alpha = alpha; this.airspeed = V;
    const qbar = 0.5 * RHO * V * V;

    // 升力係數（含失速）
    const as = s.stall * D2R;
    let CL;
    const lin = s.CL0 + s.CLa * alpha;
    if (Math.abs(alpha) < as) CL = lin;
    else {
      const edge = s.CL0 + s.CLa * as * Math.sign(alpha);
      const fall = Math.min(1, (Math.abs(alpha) - as) / (8 * D2R));
      CL = edge * (1 - fall) + 0.9 * Math.sin(2 * alpha) * fall;
    }
    this.stalled = Math.abs(alpha) > as && V > 2;
    const CD = s.CD0 + s.k * CL * CL + (this.stalled ? 0.6 * Math.abs(Math.sin(alpha)) : 0);

    const F = new Vector3(0, -s.mass * G, 0);
    if (V > 0.3) {
      const vhat = air.clone().divideScalar(V);
      const ldir = up.clone().sub(vhat.clone().multiplyScalar(up.dot(vhat)));
      if (ldir.lengthSq() > 1e-6) F.addScaledVector(ldir.normalize(), qbar * s.S * CL);
      F.addScaledVector(vhat, -qbar * s.S * CD);
      // 側向力（機身／垂尾）
      F.addScaledVector(right, -air.dot(right) * V * 0.5 * RHO * s.S * 0.6);
    }
    const vfwd = Math.max(0, air.dot(fwd));
    const T = ctrl.thr * s.thrust * Math.max(0, 1 - vfwd / s.vprop);
    F.addScaledVector(fwd, T);

    // 角速度：舵面效率隨空速，升降/方向舵另受螺旋槳氣流影響
    const aA = Math.min(1.3, V / s.vref);
    const aP = Math.min(1.3, Math.max(V / s.vref, s.propwash * ctrl.thr));
    const qn = Math.min(2, (V / s.vref) ** 2);
    const target = new Vector3(
      ctrl.ele * s.rates[0] * D2R * aP,
      -ctrl.rud * s.rates[2] * D2R * aP * (this.onGround ? 1.6 : 1),
      -ctrl.ail * s.rates[1] * D2R * aA,
    );
    const damp = [Math.max(aP, 0.15), Math.max(aP, 0.15), Math.max(aA, 0.15)];
    const acc = new Vector3(
      (target.x - this.w.x) * s.resp * damp[0] - s.stabP * (alpha - (s.trimA || 0) * D2R) * qn,
      (target.y - this.w.y) * s.resp * damp[1] - s.stabY * beta * qn,
      (target.z - this.w.z) * s.resp * damp[2] + s.dihedral * beta * qn,
    );
    // 失速時機翼下沉（翼尖失速傾向）
    if (this.stalled) acc.z += Math.sin(this.t * 3.1) * 4 * Math.min(1, V / s.vref);
    this.w.addScaledVector(acc, dt);

    // 積分
    this.vel.addScaledVector(F, dt / s.mass);
    this.pos.addScaledVector(this.vel, dt);
    const wl = this.w.length();
    if (wl > 1e-6) {
      const dq = new Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt);
      this.q.multiply(dq).normalize();
    }

    this.ground(dt, ctrl);
    if (!this.onGround) this.airTime += dt;
  }

  ground(dt, ctrl) {
    const s = this.spec;
    const gh = this.h(this.pos.x, this.pos.z);
    // 檢查翼尖、機頭、機尾是否撞地
    const pts = [[s.span / 2, 0, 0], [-s.span / 2, 0, 0], [0, 0.05, -s.length * 0.5], [0, 0.1, s.length * 0.5]];
    for (const p of pts) {
      const wp = new Vector3(...p).applyQuaternion(this.q).add(this.pos);
      if (wp.y < this.h(wp.x, wp.z) - 0.02) {
        return this.crash(p[2] < 0 ? '機頭撞地' : (p[0] ? '翼尖觸地' : '機尾撞地'));
      }
    }
    if (this.pos.y - gh > this.gearH) { this.onGround = false; return; }

    const e = new Euler().setFromQuaternion(this.q, 'YXZ');
    const vy = this.vel.y;
    if (vy < -4.5) return this.crash('落地太重 (' + (-vy).toFixed(1) + ' m/s)');
    if (Math.abs(e.z) > 30 * Math.PI / 180) return this.crash('落地時坡度過大');
    if (e.x < -12 * Math.PI / 180) return this.crash('機頭朝下觸地');

    if (!this.onGround && this.airTime > 3) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.event = vy > -1.2 ? { type: 'landing', text: '完美降落！', score: hs } : { type: 'landing', text: '安全降落', score: hs };
    }
    if (!this.onGround) this.airTime = 0;
    this.onGround = true;
    this.pos.y = gh + this.gearH;
    if (this.vel.y < 0) this.vel.y = 0;

    // 輪子摩擦：去除側滑，滾動阻力
    const hd = new Vector3(-Math.sin(e.y), 0, -Math.cos(e.y));
    const side = new Vector3(hd.z, 0, -hd.x);
    let vf = this.vel.dot(hd), vs = this.vel.dot(side);
    vs *= Math.exp(-12 * dt);
    const fr = (ctrl.thr < 0.05 ? 1.2 : 0.35) * dt;
    vf = Math.abs(vf) <= fr ? 0 : vf - Math.sign(vf) * fr;
    this.vel.set(hd.x * vf + side.x * vs, this.vel.y, hd.z * vf + side.z * vs);

    // 姿態限制：滾轉歸零、俯仰在 -3°~16°，速度不足時機頭回落
    const qn = Math.min(1, (this.airspeed / this.spec.vref) ** 2);
    e.z *= Math.exp(-10 * dt);
    e.x -= (1 - qn) * 0.8 * dt * Math.sign(e.x);
    const pmin = -3 * Math.PI / 180, pmax = 16 * Math.PI / 180;
    if (e.x < pmin) { e.x = pmin; if (this.w.x < 0) this.w.x = 0; }
    if (e.x > pmax) { e.x = pmax; if (this.w.x > 0) this.w.x = 0; }
    this.w.z *= Math.exp(-10 * dt);
    this.q.setFromEuler(e);
  }

  crash(why) {
    this.crashed = true;
    this.crashInfo = why;
    this.event = { type: 'crash', text: why };
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.airspeed = 0; this.stalled = false;
  }

  euler() { return new Euler().setFromQuaternion(this.q, 'YXZ'); }
}
