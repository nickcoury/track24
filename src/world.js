import * as THREE from 'three';
import { trackPoint, headingYaw, HALF, R1, CURB, LANE_W, LANES, STRAIGHT } from './track.js';
import { hourOfDay } from './sim.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

// ---------- helpers ----------
export function textCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function labelPlane(text, { w = 2, h = 0.5, px = 512, bg = '#0b1f3a', fg = '#ffffff', font = 'bold 64px system-ui, sans-serif' } = {}) {
  const c = textCanvas(px, Math.round(px * h / w));
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

// Band following the track between offsets o1..o2 (meters outward from lane-1 line).
function ribbon(o1, o2, y, material, samples = 360) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= samples; i++) {
    const s = (i / samples) * 400;
    const a = trackPoint(s, o1), b = trackPoint(s, o2);
    // outward normal is to the right of heading: (-hz, hx)... right of (hx,hz) in xz-plane with y up = (-hz, hx)
    pos.push(a.x, y, a.z, b.x, y, b.z);
    if (i < samples) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Make sure normals face up regardless of winding.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  material.side = THREE.DoubleSide;
  return new THREE.Mesh(geo, material);
}

// ---------- people ----------
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x5a3825];
const SHIRTS = [0xd7263d, 0x1b998b, 0x2e86ab, 0xf46036, 0xc5d86d, 0x6a4c93, 0xffffff, 0x222222, 0xffc914, 0x3bb273];

export function makePerson({ shirt, skin, shorts = 0x1e2a44, height = 1.75, bib = null, hat = null } = {}) {
  const g = new THREE.Group();
  const sc = height / 1.75;
  const skinM = lambert(skin ?? SKIN[(Math.random() * SKIN.length) | 0]);
  const shirtM = lambert(shirt ?? SHIRTS[(Math.random() * SHIRTS.length) | 0]);
  const shortsM = lambert(shorts);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.58, 10), shirtM);
  torso.position.y = 1.22;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.18, 10), shortsM);
  hips.position.y = 0.88;
  g.add(hips);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skinM);
  head.position.y = 1.64;
  g.add(head);
  if (hat) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(hat));
    cap.position.y = 1.66;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.12), lambert(hat));
    brim.position.set(0, 1.67, -0.13);
    g.add(cap, brim);
  }
  const limb = (r1, r2, len, m) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 8), m);
    mesh.position.y = -len / 2;
    pivot.add(mesh);
    return pivot;
  };
  const legL = limb(0.07, 0.05, 0.86, skinM), legR = limb(0.07, 0.05, 0.86, skinM);
  legL.position.set(-0.08, 0.88, 0); legR.position.set(0.08, 0.88, 0);
  const armL = limb(0.045, 0.04, 0.6, skinM), armR = limb(0.045, 0.04, 0.6, skinM);
  armL.position.set(-0.21, 1.47, 0); armR.position.set(0.21, 1.47, 0);
  g.add(legL, legR, armL, armR);
  if (bib != null) {
    const b = labelPlane(String(bib), { w: 0.2, h: 0.15, px: 128, bg: '#ffffff', fg: '#111', font: 'bold 70px system-ui' });
    b.material.side = THREE.FrontSide;
    b.position.set(0, 1.25, -0.172);
    b.rotation.y = Math.PI;
    g.add(b);
    const b2 = b.clone();
    b2.position.z = 0.172; b2.rotation.y = 0;
    g.add(b2);
  }
  g.scale.setScalar(sc);
  g.userData = { legL, legR, armL, armR, torso, head, phase: Math.random() * 10 };
  return g;
}

// Animate a person running at speed v (m/s). Facing -z.
export function animateRunner(p, dt, v) {
  const u = p.userData;
  const cadence = v < 0.1 ? 0 : (v < 2 ? 1.7 : 2.6 + v * 0.1); // steps/s ~ Hz*2
  u.phase += dt * cadence * Math.PI;
  const amp = Math.min(0.9, 0.25 + v * 0.16);
  const s = Math.sin(u.phase);
  u.legL.rotation.x = s * amp;
  u.legR.rotation.x = -s * amp;
  u.armL.rotation.x = -s * amp * 0.9;
  u.armR.rotation.x = s * amp * 0.9;
  u.armL.rotation.z = -0.1; u.armR.rotation.z = 0.1;
  u.torso.rotation.x = -Math.min(0.15, v * 0.03);
  p.position.y = v > 2 ? Math.abs(Math.cos(u.phase)) * 0.05 : 0;
}

// ---------- food meshes ----------
export function makeFood(key) {
  const g = new THREE.Group();
  const cup = (liquid) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.09, 14, 1, true), lambert(0xf4f4f4, { side: THREE.DoubleSide }));
    c.position.y = 0.045;
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.037, 14), lambert(liquid));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.075;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), lambert(0xeeeeee));
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.002;
    g.add(c, top, bottom);
  };
  switch (key) {
    case 'water': cup(0x9fd3ff); break;
    case 'electro': cup(0x5fe0ff); break;
    case 'cola': cup(0x3a1a0a); break;
    case 'coffee': cup(0x5a3a22); break;
    case 'broth': cup(0xd9a441); break;
    case 'banana': {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI * 0.9), lambert(0xffe135));
      m.rotation.set(Math.PI / 2, 0, 0.2); m.position.y = 0.02;
      g.add(m);
      break;
    }
    case 'gel': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.1), lambert(0xff3366));
      m.position.y = 0.006;
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.03), lambert(0xff3366));
      tab.position.set(0, 0.006, -0.06);
      g.add(m, tab);
      break;
    }
    case 'pbj': {
      const shape = new THREE.Shape();
      shape.moveTo(-0.05, -0.04); shape.lineTo(0.05, -0.04); shape.lineTo(-0.05, 0.05); shape.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }), lambert(0xe8c98f));
      m.rotation.x = -Math.PI / 2;
      const jam = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false }), lambert(0x8b1e3f));
      jam.rotation.x = -Math.PI / 2; jam.position.y = 0.012; jam.scale.setScalar(1.02);
      g.add(m, jam);
      break;
    }
    case 'potato': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), lambert(0xd8c08a));
      m.scale.set(1.2, 0.85, 1); m.position.y = 0.025;
      g.add(m);
      break;
    }
    case 'pickle': {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.08, 4, 8), lambert(0x5b8c2a));
      m.rotation.z = Math.PI / 2; m.position.y = 0.016;
      g.add(m);
      break;
    }
    case 'gummies': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.05, 12, 1, true), lambert(0xffffff, { side: THREE.DoubleSide }));
      c.position.y = 0.025; g.add(c);
      const cols = [0xff2244, 0x22cc55, 0xffcc00, 0xff8800, 0xffffff];
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), lambert(cols[i % 5]));
        b.position.set((Math.random() - 0.5) * 0.04, 0.05 + Math.random() * 0.01, (Math.random() - 0.5) * 0.04);
        g.add(b);
      }
      break;
    }
    case 'pizza': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.1); shape.lineTo(-0.06, -0.05); shape.lineTo(0.06, -0.05); shape.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }), lambert(0xf2b84b));
      m.rotation.x = -Math.PI / 2;
      g.add(m);
      for (let i = 0; i < 3; i++) {
        const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 10), lambert(0xb22222));
        pep.position.set((i - 1) * 0.025, 0.014, 0.02 - i * 0.02);
        g.add(pep);
      }
      break;
    }
  }
  g.userData.key = key;
  return g;
}

// ---------- the stadium ----------
export function buildWorld(scene) {
  const W = {};

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 0.9, 0.7) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vp;
      void main(){ float h = clamp(vp.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(vp, sunDir), 0.0); c += sunCol * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
  scene.add(W.sky);

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
    sp.push(Math.sin(ph) * Math.cos(th) * 420, Math.cos(ph) * 420, Math.sin(ph) * Math.sin(th) * 420);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  W.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }));
  scene.add(W.stars);

  W.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a5a2a, 1.0);
  W.sun = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(W.hemi, W.sun, W.sun.target);
  scene.fog = new THREE.Fog(0xcfe6ff, 120, 430);

  // Ground
  const ground = new THREE.Mesh(new THREE.CircleGeometry(440, 48), lambert(0x4f7a37));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  scene.add(ground);
  const apron = ribbon(-0.3 + LANES * LANE_W, -0.3 + LANES * LANE_W + 3, 0.0, lambert(0x9a9a94));
  scene.add(apron);
  const infield = ribbon(-14, -0.3, 0.005, lambert(0x5d9a3c));
  scene.add(infield);
  const infieldCenter = new THREE.Mesh(new THREE.PlaneGeometry(STRAIGHT, 2 * (CURB - 13)), lambert(0x5d9a3c));
  infieldCenter.rotation.x = -Math.PI / 2; infieldCenter.position.y = 0.004;
  scene.add(infieldCenter);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(CURB - 13, 32, -Math.PI / 2, Math.PI), lambert(0x5d9a3c));
    cap.rotation.x = -Math.PI / 2; cap.position.set(sx * HALF, 0.004, 0);
    if (sx < 0) cap.rotation.z = Math.PI;
    scene.add(cap);
  }

  // Track surface + lines + curb
  scene.add(ribbon(-0.3, -0.3 + LANES * LANE_W, 0.01, lambert(0xb4442e)));
  const lineM = lambert(0xf2f2f2);
  for (let k = 1; k <= LANES; k++) {
    const o = -0.3 + k * LANE_W;
    scene.add(ribbon(o - 0.025, o + 0.025, 0.015, lineM, 240));
  }
  const curb = ribbon(-0.36, -0.3, 0.05, lambert(0xffffff), 300);
  scene.add(curb);
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.08, LANES * LANE_W), lineM);
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(HALF, 0.018, CURB + LANES * LANE_W / 2);
  scene.add(finish);
  // Lap distance markers every 100m on the infield edge
  for (let m = 100; m < 400; m += 100) {
    const p = trackPoint(m, -1.2);
    const sign = labelPlane(`${m} m`, { w: 0.9, h: 0.35, px: 256, bg: '#0b1f3a' });
    sign.position.set(p.x, 0.5, p.z);
    sign.rotation.y = headingYaw(p.hx, p.hz);
    scene.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4), lambert(0x888888));
    post.position.set(p.x, 0.15, p.z);
    scene.add(post);
  }

  // Start / finish gantry with race clock
  const outerZ = CURB + LANES * LANE_W + 0.6;
  const gantry = new THREE.Group();
  const postM = lambert(0x1d1d22);
  for (const z of [CURB - 0.9, outerZ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), postM);
    p.position.set(HALF, 2.1, z);
    gantry.add(p);
  }
  const beamLen = outerZ - (CURB - 0.9);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, beamLen + 0.3), lambert(0x0b1f3a));
  beam.position.set(HALF, 4.6, (outerZ + CURB - 0.9) / 2);
  gantry.add(beam);
  const clockC = textCanvas(1024, 256);
  const clockTex = new THREE.CanvasTexture(clockC);
  clockTex.colorSpace = THREE.SRGBColorSpace;
  const clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: clockTex }));
  clockMesh.position.set(HALF - 0.21, 4.6, CURB + 1.5);
  clockMesh.rotation.y = -Math.PI / 2;
  gantry.add(clockMesh);
  const title = labelPlane('24 HOUR TRACK CHAMPIONSHIP', { w: 6, h: 0.75, px: 1024, bg: '#0b1f3a', fg: '#ffd23f', font: 'bold 60px system-ui' });
  title.position.set(HALF - 0.21, 4.6, CURB + 6.5);
  title.rotation.y = -Math.PI / 2;
  gantry.add(title);
  scene.add(gantry);
  W.clock = { canvas: clockC, tex: clockTex };

  // Aid station: tent + table on the infield just before the finish
  const aid = new THREE.Group();
  const tableX0 = HALF - 9, tableX1 = HALF - 3.5;
  const tableZ = R1 - 0.85;
  const table = new THREE.Mesh(new THREE.BoxGeometry(tableX1 - tableX0, 0.04, 0.6), lambert(0xf5f5f5));
  table.position.set((tableX0 + tableX1) / 2, 0.86, tableZ);
  aid.add(table);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(tableX1 - tableX0, 0.8, 0.58), lambert(0x2e86ab));
  skirt.position.set((tableX0 + tableX1) / 2, 0.44, tableZ);
  aid.add(skirt);
  const tentM = lambert(0x1f4e8c);
  for (const x of [tableX0 - 0.3, tableX1 + 0.3]) for (const z of [R1 - 0.45, R1 - 4]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6), lambert(0xcccccc));
    p.position.set(x, 1.3, z);
    aid.add(p);
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(tableX1 - tableX0 + 0.8, 0.25, 3.8), tentM);
  canopy.position.set((tableX0 + tableX1) / 2, 2.7, R1 - 2.3);
  aid.add(canopy);
  const aidSign = labelPlane('AID STATION', { w: 4, h: 0.25, px: 1024, bg: '#1f4e8c', fg: '#fff', font: 'bold 48px system-ui' });
  aidSign.position.set((tableX0 + tableX1) / 2, 2.7, R1 - 0.39);
  aid.add(aidSign);
  const pre = labelPlane('AID STATION 50 m', { w: 1.4, h: 0.5, px: 512, bg: '#ffd23f', fg: '#111', font: 'bold 64px system-ui' });
  const pp = trackPoint(400 - 60, -1.4);
  pre.position.set(pp.x, 1.2, pp.z);
  pre.rotation.y = -Math.PI / 2;
  aid.add(pre);
  // Big water jugs + volunteers
  for (let i = 0; i < 3; i++) {
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 14), lambert(0xff7b00));
    jug.position.set(tableX0 + 0.5 + i * 1.9, 0.86 + 0.21, tableZ - 0.18);
    aid.add(jug);
  }
  W.volunteers = [];
  for (let i = 0; i < 3; i++) {
    const v = makePerson({ shirt: 0xffd23f, hat: i === 1 ? 0xd7263d : null });
    v.position.set(tableX0 + 0.8 + i * 2, 0, tableZ - 0.9);
    v.rotation.y = Math.PI; // face the track (+z)
    v.userData.armR.rotation.x = -0.4;
    aid.add(v);
    W.volunteers.push(v);
  }
  scene.add(aid);
  W.table = { x0: tableX0, x1: tableX1, z: tableZ, top: 0.88 };

  // Camp row on the infield: chairs, coolers, a famous warning sign
  const chairM = lambert(0x2b2b2b), seatM = lambert(0x2e86ab);
  for (let i = 0; i < 9; i++) {
    const x = -HALF + 6 + i * 7.5 + Math.random() * 2;
    const z = R1 - 6 - Math.random() * 3;
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.5), seatM);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.05), seatM);
    back.position.set(0, 0.75, -0.25); back.rotation.x = -0.15;
    chair.add(seat, back);
    for (const [lx, lz] of [[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45), chairM);
      l.position.set(lx, 0.22, lz);
      chair.add(l);
    }
    chair.position.set(x, 0, z);
    chair.rotation.y = Math.PI + (Math.random() - 0.5) * 0.6;
    scene.add(chair);
    const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.35), lambert([0xd7263d, 0x2e86ab, 0xffffff][i % 3]));
    cooler.position.set(x + 0.8, 0.2, z + 0.3);
    scene.add(cooler);
    if (i % 3 === 0) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.6, 4), lambert([0xf46036, 0x3bb273, 0x6a4c93][(i / 3) % 3]));
      tent.position.set(x + 2.5, 0.8, z - 2.5);
      tent.rotation.y = Math.PI / 4;
      scene.add(tent);
    }
  }
  const beware = labelPlane('BEWARE THE CHAIR', { w: 1.8, h: 0.45, px: 512, bg: '#ffffff', fg: '#b00020', font: 'bold 56px system-ui' });
  beware.position.set(-10, 1.1, R1 - 1.6);
  const bewarePost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1), lambert(0x8b5a2b));
  bewarePost.position.set(-10, 0.45, R1 - 1.62);
  scene.add(beware, bewarePost);

  // Fence along the outside of the home straight
  const fence = new THREE.Mesh(new THREE.BoxGeometry(STRAIGHT + 20, 1.0, 0.05), lambert(0x0b1f3a));
  fence.position.set(0, 0.5, outerZ + 3.2);
  scene.add(fence);
  const fenceAd = labelPlane('EVERY LAP COUNTS  •  STAY HYDRATED  •  EVERY LAP COUNTS  •  RESPECT THE DISTANCE', { w: 60, h: 0.9, px: 4096, bg: '#0b1f3a', fg: '#ffd23f', font: 'bold 64px system-ui' });
  fenceAd.position.set(0, 0.5, outerZ + 3.17);
  fenceAd.rotation.y = Math.PI;
  scene.add(fenceAd);

  // Bleachers + instanced crowd
  const bleachers = new THREE.Group();
  const rows = 7;
  for (let r = 0; r < rows; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(STRAIGHT - 4, 0.45, 1.0), lambert(r % 2 ? 0x8d99ae : 0x9aa5b8));
    step.position.set(0, 0.22 + r * 0.45, outerZ + 5 + r * 1.0);
    step.scale.y = 1 + r * 2;
    step.position.y = (0.45 * (1 + r * 2)) / 2;
    bleachers.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(STRAIGHT - 2, 0.3, 9), lambert(0x0b1f3a));
  roof.position.set(0, 7.2, outerZ + 8);
  roof.rotation.x = 0.08;
  bleachers.add(roof);
  scene.add(bleachers);

  const N = 380;
  const bodyGeo = new THREE.CylinderGeometry(0.2, 0.17, 0.75, 8);
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
  W.crowdBodies = new THREE.InstancedMesh(bodyGeo, lambert(0xffffff), N);
  W.crowdHeads = new THREE.InstancedMesh(headGeo, lambert(0xffffff), N);
  W.crowdBase = [];
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = (Math.random() * rows) | 0;
    const x = (Math.random() - 0.5) * (STRAIGHT - 8);
    const y = 0.45 * (1 + r * 2);
    const z = outerZ + 5 + r * 1.0 + (Math.random() - 0.5) * 0.3;
    W.crowdBase.push({ x, y, z, ph: Math.random() * 6.28, order: Math.random() });
    m4.makeTranslation(x, y + 0.38, z);
    W.crowdBodies.setMatrixAt(i, m4);
    W.crowdBodies.setColorAt(i, col.setHex(SHIRTS[(Math.random() * SHIRTS.length) | 0]));
    m4.makeTranslation(x, y + 0.88, z);
    W.crowdHeads.setMatrixAt(i, m4);
    W.crowdHeads.setColorAt(i, col.setHex(SKIN[(Math.random() * SKIN.length) | 0]));
  }
  // Sort so lowering .count at night removes a random subset.
  W.crowdBase.forEach((b, i) => (b.i = i));
  scene.add(W.crowdBodies, W.crowdHeads);

  // Rail fans: individual people at the fence near the finish who cheer
  W.fans = [];
  for (let i = 0; i < 16; i++) {
    const p = makePerson({ hat: Math.random() < 0.3 ? SHIRTS[i % SHIRTS.length] : null });
    p.position.set(HALF - 40 + i * 2.6 + Math.random(), 0, outerZ + 3.7 + Math.random() * 0.4);
    // default facing is -z, i.e. toward the track
    p.userData.armL.rotation.z = -0.15;
    p.userData.armR.rotation.z = 0.15;
    scene.add(p);
    W.fans.push(p);
  }

  // Scoreboard across the infield, behind the back straight
  const sbC = textCanvas(1024, 512);
  const sbTex = new THREE.CanvasTexture(sbC);
  sbTex.colorSpace = THREE.SRGBColorSpace;
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: sbTex }));
  sb.position.set(0, 11, -R1 - 18);
  scene.add(sb);
  const sbFrame = new THREE.Mesh(new THREE.BoxGeometry(18.8, 9.8, 0.6), lambert(0x111111));
  sbFrame.position.set(0, 11, -R1 - 18.35);
  scene.add(sbFrame);
  for (const x of [-6, 6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), lambert(0x333333));
    leg.position.set(x, 3.3, -R1 - 18.5);
    scene.add(leg);
  }
  W.scoreboard = { canvas: sbC, tex: sbTex };

  // Light towers
  W.lamps = [];
  const lampM = new THREE.MeshBasicMaterial({ color: 0x333333 });
  for (const [x, z] of [[-75, 58], [75, 58], [-75, -58], [75, -58]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 28, 8), lambert(0x777777));
    pole.position.set(x, 14, z);
    const bank = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 0.6), lampM);
    bank.position.set(x * 0.98, 28.5, z * 0.98);
    bank.lookAt(0, 0, 0);
    scene.add(pole, bank);
  }
  W.lampMat = lampM;

  // Tree line
  const T = 140;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), lambert(0x5b3a1e), T);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(3, 9, 7), lambert(0x2f5d2a), T);
  for (let i = 0; i < T; i++) {
    const a = (i / T) * Math.PI * 2 + Math.random() * 0.03;
    const rr = 120 + Math.random() * 60;
    const s = 0.8 + Math.random() * 0.8;
    m4.compose(new THREE.Vector3(Math.cos(a) * rr * 1.2, 1.5 * s, Math.sin(a) * rr), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(Math.cos(a) * rr * 1.2, (3 + 4.5) * s, Math.sin(a) * rr), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    crowns.setMatrixAt(i, m4);
  }
  scene.add(trunks, crowns);

  return W;
}

// ---------- time of day ----------
const KEYS = [
  // hour, sky top, horizon, sun intensity, hemi intensity, lamps (0..1)
  [0, 0x03050c, 0x0c1426, 0.0, 0.9, 1],
  [5.0, 0x050915, 0x18203a, 0.0, 0.9, 1],
  [6.3, 0x2a3a6a, 0xf0a070, 0.4, 0.8, 0.6],
  [7.5, 0x3d72c4, 0xd9e8ff, 1.2, 1.0, 0],
  [12, 0x2f6fd0, 0xcfe6ff, 1.8, 1.1, 0],
  [17.5, 0x3a6fc0, 0xe4e8f0, 1.2, 1.0, 0],
  [19.2, 0x2b2f63, 0xff8a50, 0.4, 0.8, 0.6],
  [20.2, 0x0a0f24, 0x1d2240, 0.0, 0.9, 1],
  [24, 0x03050c, 0x0c1426, 0.0, 0.9, 1],
];
const cA = new THREE.Color(), cB = new THREE.Color();
export function setTimeOfDay(W, scene, t) {
  const h = hourOfDay(t);
  let i = 0;
  while (KEYS[i + 1][0] < h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = (h - a[0]) / (b[0] - a[0]);
  const top = cA.setHex(a[1]).lerp(cB.setHex(b[1]), f).clone();
  const hor = cA.setHex(a[2]).lerp(cB.setHex(b[2]), f).clone();
  const sunI = a[3] + (b[3] - a[3]) * f;
  const hemiI = a[4] + (b[4] - a[4]) * f;
  const lamps = a[5] + (b[5] - a[5]) * f;
  W.sky.material.uniforms.top.value.copy(top);
  W.sky.material.uniforms.horizon.value.copy(hor);
  // Sun arcs east->west between 6:30 and 19:30
  const sa = ((h - 6.5) / 13) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(sa), Math.sin(sa), -0.35).normalize();
  W.sky.material.uniforms.sunDir.value.copy(sunDir);
  W.sun.position.copy(sunDir).multiplyScalar(100);
  W.sun.intensity = sunI;
  // Night: floodlights give a flat, slightly cool light.
  W.hemi.intensity = hemiI;
  W.hemi.color.setHex(0xcfe6ff).lerp(cB.setHex(0xe8eeff), lamps);
  W.hemi.groundColor.setHex(0x3a5a2a).lerp(cB.setHex(0x3b3b44), lamps);
  W.stars.material.opacity = Math.max(0, lamps - 0.3) / 0.7;
  W.lampMat.color.setHex(lamps > 0.3 ? 0xfff6dd : 0x333333);
  scene.fog.color.copy(hor);
  // Thin the crowd overnight.
  const frac = lamps > 0.5 ? 0.18 : 1;
  const n = Math.round(W.crowdBase.length * frac);
  W.crowdBodies.count = n; W.crowdHeads.count = n;
  W.fans.forEach((p, i) => (p.visible = lamps < 0.5 || i % 4 === 0));
}
