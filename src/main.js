import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import * as S from './sim.js';
import { trackPoint, headingYaw, HALF, R1 } from './track.js';
import { buildWorld, setTimeOfDay, makePerson, animateRunner, makeFood, textCanvas } from './world.js';
import { Strides, ArmSwing } from './input.js';
import * as HUD from './hud.js';
import { Sound } from './audio.js';

const params = new URLSearchParams(location.search);
const TS = Math.max(1, Number(params.get('ts')) || 1); // dev: race-time multiplier
const DEV = params.has('dev');
const SAVE_KEY = 'track24.race.v1';
const BEST_KEY = 'track24.best.v1';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- state
function freshState() {
  return { phase: 'pre', r: S.newRunner(), rivals: S.newRivals(1 + Math.floor(Math.random() * 2e9)), savedAt: Date.now() };
}
let st = store.get(SAVE_KEY);
if (!st || !st.r || !st.rivals) st = freshState();
st.r.events = [];
if (st.phase === 'countdown') st.phase = 'pre';
const R = () => st.r;

function save() {
  st.savedAt = Date.now();
  const r = { ...st.r, events: [] };
  store.set(SAVE_KEY, { ...st, r });
}

// ---------------------------------------------------------------- three
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 1200);
const rig = new THREE.Group();     // follows the rail
const body = new THREE.Group();    // fall / stumble motion
rig.add(body);
body.add(camera);
scene.add(rig);
camera.position.set(0, 1.7, 0);

const W = buildWorld(scene);

// Screen veil for blinks, bonks, falls, nausea. Works in XR and flat.
const veil = new THREE.Mesh(
  new THREE.SphereGeometry(0.4, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }),
);
veil.renderOrder = 999;
camera.add(veil);

// Rivals
const rivalMeshes = st.rivals.map((rv) => {
  const m = makePerson({ bib: rv.bib, shirt: [0xd7263d, 0x1b998b, 0x2e86ab, 0xf46036, 0x6a4c93, 0x777777, 0xffc914][rv.i % 7], hat: rv.i === 5 ? 0xffffff : null });
  m.userData.off = 1.22;
  m.userData.prevRel = null;
  scene.add(m);
  return m;
});

// Aid table items
const FOOD_ORDER = ['water', 'electro', 'cola', 'coffee', 'broth', 'banana', 'gel', 'pbj', 'potato', 'pickle', 'gummies', 'pizza'];
const FOOD_ICON = { water: '💧', electro: '🧃', cola: '🥤', coffee: '☕', broth: '🍜', banana: '🍌', gel: '⚡', pbj: '🥪', potato: '🥔', pickle: '🥒', gummies: '🍬', pizza: '🍕' };
const DRINKS = new Set(['water', 'electro', 'cola', 'coffee', 'broth']);
const items = FOOD_ORDER.map((key, i) => {
  const mesh = makeFood(key);
  const span = W.table.x1 - W.table.x0;
  const x = W.table.x0 + 0.25 + (i / (FOOD_ORDER.length - 1)) * (span - 0.5);
  mesh.position.set(x, W.table.top, W.table.z + 0.2);
  scene.add(mesh);
  return { key, mesh, home: mesh.position.clone(), availableAt: 0 };
});

// Speech bubbles
const bubbles = [0, 1, 2].map(() => {
  const c = textCanvas(512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false;
  scene.add(m);
  return { mesh: m, canvas: c, tex, until: 0, target: null, height: 2.4 };
});
function say(target, text, { height = 2.4, voice = true, pitch } = {}) {
  const b = bubbles.find((x) => !x.mesh.visible) || bubbles.reduce((a, b) => (a.until < b.until ? a : b));
  HUD.drawBubble(b.canvas, text);
  b.tex.needsUpdate = true;
  b.target = target; b.height = height;
  b.until = clock() + 3.2;
  b.mesh.visible = true;
  if (voice) sound.speak(text, { pitch: pitch ?? 0.8 + Math.random() * 0.8, rate: 1.1 });
}

// In-world message panel (used in XR; flat mode uses the DOM).
const panelC = textCanvas(1024, 512);
const panelTex = new THREE.CanvasTexture(panelC);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, depthTest: false }));
panel.renderOrder = 998;
panel.position.set(0, 1.45, -1.8);
panel.visible = false;
body.add(panel);
function drawPanel(lines, color = '#fff') {
  const g = panelC.getContext('2d');
  g.clearRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(6,12,22,0.85)';
  g.beginPath(); g.roundRect?.(0, 0, 1024, 512, 40); g.fill();
  if (!g.roundRect) g.fillRect(0, 0, 1024, 512);
  g.textAlign = 'center';
  lines.forEach((l, i) => {
    g.fillStyle = i === 0 ? '#ffd23f' : color;
    g.font = i === 0 ? 'bold 72px system-ui, sans-serif' : '44px system-ui, sans-serif';
    g.fillText(l, 512, 110 + i * (i === 0 ? 0 : 66) + (i > 0 ? 50 : 0));
  });
  panelTex.needsUpdate = true;
}

// ---------------------------------------------------------------- HUD canvases
const watchC = textCanvas(512, 512);
const bodyC = textCanvas(512, 512);
$('watch').appendChild(watchC);
$('bodyp').appendChild(bodyC);
const watchTex = new THREE.CanvasTexture(watchC);
const bodyTex = new THREE.CanvasTexture(bodyC);
watchTex.colorSpace = bodyTex.colorSpace = THREE.SRGBColorSpace;

// ---------------------------------------------------------------- sound
const sound = new Sound();

// ---------------------------------------------------------------- XR hands
const hands = [0, 1].map((i) => {
  const grip = renderer.xr.getControllerGrip(i);
  const ctrl = renderer.xr.getController(i);
  body.add(grip, ctrl);
  const glove = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.1), new THREE.MeshLambertMaterial({ color: 0x24272e }));
  palm.position.set(0, 0, -0.02);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 14), new THREE.MeshLambertMaterial({ color: 0xd7263d }));
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 0, 0.08);
  glove.add(palm, band);
  grip.add(glove);
  const h = { i, grip, ctrl, side: i === 0 ? 'left' : 'right', swing: new ArmSwing(i), held: null, squeeze: false, trigger: false, panel: null, gamepad: null };
  ctrl.addEventListener('connected', (e) => {
    h.side = e.data.handedness || h.side;
    h.gamepad = e.data.gamepad;
    attachWristPanel(h);
  });
  ctrl.addEventListener('squeezestart', () => { h.squeeze = true; onSqueeze(h); });
  ctrl.addEventListener('squeezeend', () => { h.squeeze = false; dropHeld(h); });
  ctrl.addEventListener('selectstart', () => { h.trigger = true; onTrigger(); });
  ctrl.addEventListener('selectend', () => { h.trigger = false; });
  return h;
});

function attachWristPanel(h) {
  if (h.panel) h.grip.remove(h.panel);
  const left = h.side === 'left';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ map: left ? watchTex : bodyTex, transparent: true }));
  // Face the back of the wrist; text reads with fingers to the right (left wrist)
  // or elbow to the right (right wrist).
  const n = new THREE.Vector3(left ? -1 : 1, 0, 0);
  const rgt = new THREE.Vector3(0, 0, left ? -1 : 1);
  const up = new THREE.Vector3().crossVectors(n, rgt);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rgt, up, n));
  m.position.set(left ? -0.05 : 0.05, 0.0, 0.1);
  h.grip.add(m);
  h.panel = m;
}

// ---------------------------------------------------------------- input state
const strides = new Strides();
let stumble = null;   // { deadline }
let down = null;      // { at, rising, riseAt }
let lookYaw = 0, lookPitch = 0;
let cruise = 0;
let lastStepSound = 0;
let clockSkew = 0; // dev frame-stepping
const clock = () => performance.now() / 1000 + clockSkew;

function inXR() { return renderer.xr.isPresenting; }

function stride(side, amp, single = false) {
  if (st.phase !== 'running' || down) return;
  const now = clock();
  const same = strides.add(side, amp, now, single);
  const r = R();
  if (now - lastStepSound > 0.15) { sound.step(r.speed); lastStepSound = now; }
  if (strides.times.length % 2 === 0) sound.breath(Math.min(1, r.speed / 5 + r.legs / 200));
  if (stumble) {
    stumble = null;
    flash('Caught it!', 'ok', 1.2);
    return;
  }
  if (r.speed > 1 && Math.random() < S.stumbleChance(r)) startStumble('Toe caught! Keep your legs going!');
  else if (same && r.speed > 2.6) startStumble('Feet tangled! Alternate!');
}

function startStumble(text) {
  if (stumble || down) return;
  stumble = { deadline: clock() + 0.8, at: clock() };
  sound.whoa();
  flash(text, 'warn', 1.0);
}

function doFall() {
  stumble = null;
  down = { at: clock(), rising: false };
  S.fall(R());
  strides.reset();
  sound.thud();
  flash(inXR() ? 'You went down. Hold both grips to get up.' : 'You went down. Tap GET UP.', 'bad', 4);
  heckle(true);
}

function getUp() {
  if (!down || down.rising) return;
  if (clock() - down.at < 1.2) { down.wantUp = true; return; }
  down.rising = true;
  down.riseAt = clock();
}

// ---------------------------------------------------------------- food
let tray = [];
function itemAvailable(it) { return clock() >= it.availableAt; }
function takeItem(it) {
  it.availableAt = clock() + 6;
  it.mesh.visible = false;
}

function consume(key) {
  const r = R();
  const drink = DRINKS.has(key);
  let frac = 1;
  if (drink && r.speed > 3.0) { frac = 0.5; flash('Half of it went up your nose.', 'warn', 2); }
  S.eat(r, key, frac);
  drink ? sound.gulp() : sound.chomp();
  const f = S.FOODS[key];
  if (frac === 1) flash(`${f.name}${f.kcal ? ` +${Math.round(f.kcal)} kcal` : ''}${f.ml ? ` +${f.ml} ml` : ''}`, 'ok', 1.6);
}

// Flat/phone: tap an item from the tray while passing the table.
function trayEat(i) {
  const it = items[i];
  if (!it || !itemAvailable(it) || !nearTable()) return;
  const r = R();
  const fumble = Math.max(0, Math.min(0.75, (r.speed - 2.4) / 2.5));
  takeItem(it);
  if (Math.random() < fumble) { flash(`Fumbled the ${S.FOODS[it.key].name.toLowerCase()}. Slow down at the table.`, 'warn', 2); return; }
  consume(it.key);
}

// XR: grab with grip, lift to mouth.
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function onSqueeze(h) {
  if (down) return;
  if (h.held) return;
  h.grip.getWorldPosition(tmpV);
  let best = null, bestD = 0.17;
  for (const it of items) {
    if (!itemAvailable(it)) continue;
    const d = it.mesh.getWorldPosition(tmpV2).distanceTo(tmpV);
    if (d < bestD) { best = it; bestD = d; }
  }
  if (!best) return;
  const r = R();
  if (Math.random() < Math.max(0, Math.min(0.6, (r.speed - 3.2) / 3))) {
    takeItem(best);
    flash('Knocked it off the table.', 'warn', 1.5);
    return;
  }
  takeItem(best);
  const m = makeFood(best.key);
  m.position.set(0, -0.01, -0.07);
  h.grip.add(m);
  h.held = { key: best.key, mesh: m, eatT: 0 };
  pulse(h, 0.4, 40);
}
function dropHeld(h) {
  if (!h.held) return;
  h.grip.remove(h.held.mesh);
  h.held = null;
}
function pulse(h, intensity, ms) {
  try { h.gamepad?.hapticActuators?.[0]?.pulse(intensity, ms); } catch { /* no haptics */ }
}
const mouth = new THREE.Vector3();
function updateHeld(dt) {
  camera.getWorldPosition(mouth);
  mouth.y -= 0.1;
  for (const h of hands) {
    if (!h.held) continue;
    const d = h.held.mesh.getWorldPosition(tmpV).distanceTo(mouth);
    if (d < 0.17) {
      h.held.eatT += dt;
      if (h.held.eatT > 0.45) {
        consume(h.held.key);
        pulse(h, 0.6, 80);
        dropHeld(h);
      }
    } else h.held.eatT = 0;
  }
}

// ---------------------------------------------------------------- messages
let msgTimer = 0;
function flash(text, kind = 'info', secs = 2.5) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'show ' + kind;
  msgTimer = clock() + secs;
  if (inXR()) { drawPanel([text]); panel.visible = true; panel.scale.setScalar(0.6); panel.position.y = 1.25; }
}

// ---------------------------------------------------------------- race flow
let countdownAt = 0;
function startCountdown() {
  if (st.phase !== 'pre') return;
  sound.init();
  st.phase = 'countdown';
  countdownAt = clock() + 10;
  $('start').classList.add('hidden');
  sound.speak('Runners, the twenty four hour track championship begins in ten seconds.', { pitch: 0.7, rate: 1 });
}
function beginRace() {
  st.phase = 'running';
  sound.horn();
  sound.cheer(1);
  flash('GO! 24 hours. Every lap counts.', 'ok', 3);
  panel.visible = false;
  save();
}
function finish() {
  st.phase = 'done';
  const r = R();
  r.t = S.RACE_SECONDS;
  sound.horn();
  sound.cheer(1);
  const mi = r.dist / S.MILE;
  const all = [{ dist: r.dist, you: true }, ...st.rivals].sort((a, b) => b.dist - a.dist);
  const place = all.findIndex((x) => x.you) + 1;
  const best = store.get(BEST_KEY) || 0;
  if (mi > best) store.set(BEST_KEY, mi);
  st.result = { mi, place, buckle: S.buckle(mi), best: Math.max(best, mi) };
  sound.speak(`The twenty four hours are complete. Runner number one finishes with ${mi.toFixed(1)} miles.`, { pitch: 0.7, rate: 1 });
  showResults();
  save();
}
function showResults() {
  const r = R(), res = st.result;
  if (!res) return;
  $('results').innerHTML = `
    <h2>FINISH</h2>
    <div class="big">${res.mi.toFixed(2)} miles</div>
    <div>${res.buckle}</div>
    <div>Place: ${res.place} of ${st.rivals.length + 1}</div>
    <div class="dim">${Math.floor(r.dist / S.TRACK_LEN)} laps · ${Math.round(r.kcalEaten)} kcal eaten · ${(r.mlDrunk / 1000).toFixed(1)} L drunk · ${r.falls} falls</div>
    <div class="dim">Personal best: ${res.best.toFixed(2)} mi</div>
    <button id="again">New race</button>`;
  $('results').classList.remove('hidden');
  $('again').onclick = newRace;
  drawPanel(['FINISH', `${res.mi.toFixed(2)} miles · ${res.buckle}`, `Place ${res.place} of ${st.rivals.length + 1}`, `${r.falls} falls · ${Math.round(r.kcalEaten)} kcal eaten`, 'Pull trigger for a new race']);
  panel.visible = inXR();
  panel.scale.setScalar(1); panel.position.y = 1.45;
}
function newRace() {
  st = freshState();
  st.rivals.forEach((rv, i) => { rivalMeshes[i].userData.prevRel = null; });
  strides.reset(); stumble = null; down = null;
  for (const it of items) it.availableAt = 0;
  save();
  $('results').classList.add('hidden');
  showStart();
}

// Time passes whether or not you're here. Away = sitting in the chair.
function processGap(sec) {
  if (st.phase !== 'running' || sec <= 0) return;
  const r = R();
  sec = Math.min(sec, S.RACE_SECONDS - r.t);
  let left = sec;
  while (left > 0) {
    const ch = Math.min(30, left);
    S.step(r, ch, 0);
    S.stepRivals(st.rivals, r.t, ch);
    left -= ch;
  }
  r.events = [];
  r.speed = 0;
  strides.reset(); stumble = null;
  if (sec > 90) {
    const txt = `You sat in the chair for ${HUD.fmtClock(sec, false).replace(':', 'h ')}m. The clock did not.`;
    flash(txt, 'warn', 6);
  }
  if (r.t >= S.RACE_SECONDS) finish();
}

function onTrigger() {
  sound.init();
  if (st.phase === 'pre') startCountdown();
  else if (st.phase === 'done') newRace();
}

// ---------------------------------------------------------------- crowd + PA
let nextCheer = 0, nextPA = clock() + 300 + Math.random() * 240, lastHour = Math.floor(R().t / 3600);
let lastVolunteerLap = -1, prevMi = R().dist / S.MILE;
const fanCheer = new Map();

function heckle(fallen = false) {
  const r = R();
  const p = trackPoint(r.dist % S.TRACK_LEN);
  if (!(p.z > 30 && Math.abs(p.x) < HALF + 3)) return false;
  // nearest visible fan ahead
  let best = null, bd = 1e9;
  for (const f of W.fans) {
    if (!f.visible) continue;
    const dx = f.position.x - p.x;
    if (dx < 2 || dx > 22) continue;
    if (dx < bd) { bd = dx; best = f; }
  }
  if (!best) return false;
  say(best, HUD.crowdLine(r, { fallen }), { height: 2.7 });
  fanCheer.set(best, clock() + 2.5);
  sound.cheer(fallen ? 1 : 0.5);
  return true;
}

function crowdAndPA() {
  const now = clock(), r = R();
  if (now > nextCheer) {
    nextCheer = now + (heckle() ? 5 + Math.random() * 5 : 1);
  }
  // Volunteers call out as you approach the table, once per lap.
  const lap = Math.floor(r.dist / S.TRACK_LEN);
  const p = trackPoint(r.dist % S.TRACK_LEN);
  if (p.z > 30 && p.x > W.table.x0 - 14 && p.x < W.table.x0 - 6 && lastVolunteerLap !== lap) {
    lastVolunteerLap = lap;
    say(W.volunteers[(Math.random() * 3) | 0], HUD.volunteerLine(r), { height: 2.4 });
  }
  const mi = r.dist / S.MILE;
  const ms = HUD.milestone(prevMi, mi);
  prevMi = mi;
  if (ms) {
    flash(`${ms.toUpperCase()}!`, 'ok', 4);
    sound.cheer(1);
    sound.speak(`Runner number one has just completed ${ms}.`, { pitch: 0.7, rate: 1 });
  }
  const hour = Math.floor(r.t / 3600);
  if (hour !== lastHour) {
    lastHour = hour;
    const left = 24 - hour;
    if (left > 0) {
      sound.speak(`Hour ${hour} is complete. ${left} hour${left === 1 ? '' : 's'} remain.`, { pitch: 0.7, rate: 1 });
      flash(`HOUR ${hour} COMPLETE · ${left} TO GO`, 'info', 4);
    }
  }
  if (now > nextPA) {
    nextPA = now + 360 + Math.random() * 300;
    sound.speak(HUD.PA_LINES[(Math.random() * HUD.PA_LINES.length) | 0], { pitch: 0.7, rate: 1 });
  }
}

// ---------------------------------------------------------------- per frame
let lastFrame = clock(), uiTick = 0, slowTick = 0, saveTick = 0, blink = null, nextBlink = 0;
const headPos = new THREE.Vector3(), handPos = new THREE.Vector3(), fwd = new THREE.Vector3();

function updateArms(dt, now) {
  camera.getWorldPosition(headPos);
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) return;
  fwd.normalize();
  const busy = hands.some((h) => h.held);
  for (const h of hands) {
    if (!h.grip.visible && !h.gamepad) continue;
    h.grip.getWorldPosition(handPos).sub(headPos);
    const f = handPos.dot(fwd);
    const amp = h.swing.update(f, handPos.y, dt, now);
    if (amp != null) {
      stride(h.side, amp, busy && !h.held);
      pulse(h, 0.15, 15);
    }
  }
  // Get up: hold both grips.
  if (down && hands.every((h) => h.squeeze)) {
    if (!down.gripSince) down.gripSince = now;
    if (now - down.gripSince > 0.8) getUp();
  } else if (down) down.gripSince = null;
}

function update() {
  const now = clock();
  let dtReal = now - lastFrame;
  lastFrame = now;
  if (dtReal > 2) { processGap(dtReal * TS); dtReal = 0; }
  const dt = Math.min(dtReal, 0.1);
  const r = R();

  if (st.phase === 'countdown') {
    const left = Math.ceil(countdownAt - now);
    const txt = left > 0 ? `${left}` : 'GO';
    $('msg').textContent = left > 0 ? `Race starts in ${left}` : 'GO';
    $('msg').className = 'show info';
    if (inXR()) { drawPanel(['24 HOURS', `Starts in ${txt}`]); panel.visible = true; panel.scale.setScalar(1); panel.position.y = 1.45; }
    if (now >= countdownAt) beginRace();
  }

  if (st.phase === 'running') {
    if (inXR()) updateArms(dt, now);
    updateHeld(dt);
    const simDt = dt * TS;
    let desired = down ? 0 : strides.targetSpeed(now);
    if (DEV && cruise) desired = cruise;
    S.step(r, simDt, desired);
    S.stepRivals(st.rivals, r.t, simDt);

    for (const e of r.events) {
      if (e.type === 'lap') { sound.beep(); }
      if (e.type === 'vomit') { sound.blech(); flash('Your stomach has rejected everything. Including the pizza.', 'bad', 4); veilFlash(0x3a5f0b, 0.6); }
      if (e.type === 'cramp') { flash('CRAMP! Calf locked up. Walk it off. Salt helps.', 'bad', 4); sound.whoa(); }
    }
    r.events.length = 0;

    if (!down && !(DEV && cruise)) {
      if (stumble && now > stumble.deadline) doFall();
      else if (!stumble && r.speed > 2.0 && now - strides.last > 1.0) startStumble('Keep your legs moving or you\'ll eat track!');
    }
    if (down && down.wantUp && !down.rising && now - down.at >= 1.2) getUp();
    if (down && down.rising && now - down.riseAt > 1.6) { down = null; flash('Back up. Shake it off.', 'ok', 1.5); }

    crowdAndPA();
    if (r.t >= S.RACE_SECONDS) finish();
  }

  // ---- place the runner on the rail
  const p = trackPoint(r.dist % S.TRACK_LEN);
  rig.position.set(p.x, 0, p.z);
  rig.rotation.y = headingYaw(p.hx, p.hz);

  // fall / stumble body motion
  let fallAmt = 0;
  if (down) {
    const a = Math.min(1, (now - down.at) / 0.35);
    fallAmt = down.rising ? Math.max(0, 1 - (now - down.riseAt) / 1.5) : a * a;
  }
  const wob = stumble ? Math.sin((now - stumble.at) * 30) * 0.06 * Math.max(0, 1 - (now - stumble.at) / 0.8) : 0;
  body.position.y = -1.2 * fallAmt;
  body.rotation.z = 0.45 * fallAmt + wob;
  body.rotation.x = -0.25 * fallAmt + Math.abs(wob);

  if (!inXR()) {
    // gentle running bob in flat mode only
    const bob = r.speed > 0.5 ? Math.sin(now * (2.6 + r.speed * 0.3) * Math.PI) * Math.min(0.035, r.speed * 0.01) : 0;
    camera.position.set(0, 1.7 + bob, 0);
    camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  }

  // ---- veil: microsleeps, bonk dimming
  const drowsy = S.drowsiness(r);
  let veilOp = 0, veilCol = 0x000000;
  if (st.phase === 'running') {
    if (!blink && drowsy > 0.45 && now > nextBlink) {
      blink = { at: now, len: 0.4 + drowsy * 0.8 };
      nextBlink = now + 8 + Math.random() * 30 * (1.2 - drowsy);
    }
    if (blink) {
      const k = (now - blink.at) / blink.len;
      veilOp = k < 0.3 ? k / 0.3 : k < 0.7 ? 1 : Math.max(0, (1 - k) / 0.3);
      veilOp *= 0.96;
      if (k >= 1) blink = null;
    }
    if (r.energy < 300) veilOp = Math.max(veilOp, 0.35 * (1 - r.energy / 300));
    if (fallAmt > 0) { veilOp = Math.max(veilOp, 0.3 * fallAmt); veilCol = 0x330000; }
  }
  if (veilFx && now < veilFx.until) { veilOp = Math.max(veilOp, veilFx.op * (veilFx.until - now) / veilFx.len); veilCol = veilFx.col; }
  veil.material.opacity = veilOp;
  veil.material.color.setHex(veilCol);
  veil.visible = veilOp > 0.01;

  // ---- rivals
  for (const rv of st.rivals) {
    const m = rivalMeshes[rv.i];
    const targetOff = rv.stop > 0 ? -2.4 : 1.22;
    m.userData.off += (targetOff - m.userData.off) * Math.min(1, dt * 0.8);
    const q = trackPoint(rv.dist % S.TRACK_LEN, m.userData.off);
    m.position.set(q.x, 0, q.z);
    m.rotation.y = headingYaw(q.hx, q.hz);
    animateRunner(m, dt, rv.speed);
    const rel = ((rv.dist - r.dist) % 400 + 600) % 400 - 200;
    const pr = m.userData.prevRel;
    if (st.phase === 'running' && pr != null && Math.abs(rel) < 4 && rv.stop <= 0) {
      if (pr > 0 && rel <= 0) say(m, ['Nice work!', 'Looking good!', 'Go get it!'][(Math.random() * 3) | 0], { height: 2.2, pitch: 1 });
      else if (pr < 0 && rel >= 0) say(m, ['On your right!', 'Keep it up!', 'Good job, buddy.', 'Another lap!'][(Math.random() * 4) | 0], { height: 2.2, pitch: 1 });
    }
    m.userData.prevRel = rel;
  }

  // ---- fans / volunteers
  for (const f of W.fans) {
    const u = f.userData;
    const cheering = (fanCheer.get(f) || 0) > now;
    const lift = cheering ? -2.8 + Math.sin(now * 12) * 0.25 : 0;
    u.armL.rotation.x += (lift - u.armL.rotation.x) * Math.min(1, dt * 8);
    u.armR.rotation.x += (lift - u.armR.rotation.x) * Math.min(1, dt * 8);
    f.position.y = cheering ? Math.abs(Math.sin(now * 8)) * 0.15 : 0;
  }

  // ---- bubbles
  for (const b of bubbles) {
    if (!b.mesh.visible) continue;
    if (now > b.until || !b.target) { b.mesh.visible = false; continue; }
    b.target.getWorldPosition(tmpV);
    b.mesh.position.set(tmpV.x, tmpV.y + b.height, tmpV.z);
    camera.getWorldPosition(tmpV2);
    b.mesh.lookAt(tmpV2);
  }

  // ---- table items reappear
  for (const it of items) if (!it.mesh.visible && itemAvailable(it)) it.mesh.visible = true;

  // ---- periodic UI
  if (now > uiTick) {
    uiTick = now + 0.25;
    const note = down ? 'DOWN' : stumble ? 'STUMBLE!' : S.status(r)[0]?.replace('-', ' ').toUpperCase();
    HUD.drawWatch(watchC, r, { note });
    HUD.drawBody(bodyC, r);
    watchTex.needsUpdate = bodyTex.needsUpdate = true;
    updateTray();
    $('getup').classList.toggle('hidden', !(down && !down.rising) || inXR());
    $('pads').classList.toggle('hidden', st.phase !== 'running' || inXR() || !!down);
    if (msgTimer && now > msgTimer) { $('msg').className = ''; msgTimer = 0; if (st.phase === 'running') panel.visible = false; }
  }
  if (now > slowTick) {
    slowTick = now + 1;
    HUD.drawRaceClock(W.clock.canvas, r, st.phase);
    W.clock.tex.needsUpdate = true;
    HUD.drawScoreboard(W.scoreboard.canvas, r, st.rivals, st.phase);
    W.scoreboard.tex.needsUpdate = true;
    setTimeOfDay(W, scene, r.t);
    const onHome = p.z > 30;
    const night = S.isNight(r.t);
    sound.ambience((onHome ? 0.07 : 0.025) * (night ? 0.35 : 1), night ? 1 : 0);
  }
  if (st.phase === 'running' && now > saveTick) { saveTick = now + 5; save(); }
}

let veilFx = null;
function veilFlash(col, op, len = 1.5) { veilFx = { col, op, len, until: clock() + len }; }

function nearTable() {
  const p = trackPoint(R().dist % S.TRACK_LEN);
  return p.z > 30 && p.x > W.table.x0 - 2.5 && p.x < W.table.x1 + 0.5;
}

let trayShown = '';
function updateTray() {
  const show = st.phase === 'running' && !inXR() && !down && nearTable();
  const sig = show ? items.map((it) => (itemAvailable(it) ? 1 : 0)).join('') : '';
  if (sig === trayShown) return;
  trayShown = sig;
  const el = $('tray');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = items.map((it, i) => `<button data-i="${i}" ${itemAvailable(it) ? '' : 'disabled'}><span>${FOOD_ICON[it.key]}</span>${S.FOODS[it.key].name}</button>`).join('');
}
$('tray').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (b) { e.preventDefault(); trayEat(Number(b.dataset.i)); trayShown = 'x'; }
});

// ---------------------------------------------------------------- flat input
const KEYMAP = { KeyF: 'left', KeyA: 'left', ArrowLeft: 'left', KeyJ: 'right', KeyL: 'right', ArrowRight: 'right' };
const TRAY_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const side = KEYMAP[e.code];
  if (side) { sound.init(); stride(side, 0.27); e.preventDefault(); return; }
  if (e.code === 'Space') { getUp(); e.preventDefault(); }
  if (e.code === 'Enter' && st.phase === 'pre') startCountdown();
  const ti = TRAY_KEYS.indexOf(e.code);
  if (ti >= 0) trayEat(ti);
  if (DEV && e.code === 'KeyC') { cruise = cruise ? 0 : 3.2; flash(cruise ? 'DEV cruise on' : 'DEV cruise off'); }
  if (DEV && e.code === 'KeyT') { processGap(3600); }
});
for (const side of ['left', 'right']) {
  $(side === 'left' ? 'padL' : 'padR').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.init();
    stride(side, 0.27);
    e.currentTarget.classList.add('hit');
    setTimeout(() => e.currentTarget?.classList.remove('hit'), 90);
  });
}
$('getup').addEventListener('pointerdown', (e) => { e.preventDefault(); getUp(); });

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  lookYaw += (e.clientX - drag.x) * 0.005;
  lookPitch = Math.max(-1.2, Math.min(1.0, lookPitch + (e.clientY - drag.y) * 0.004));
  lookYaw = Math.max(-2.2, Math.min(2.2, lookYaw));
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });

// ---------------------------------------------------------------- start UI
function showStart() {
  const el = $('start');
  el.classList.remove('hidden');
  const r = R();
  const resume = st.phase === 'running';
  $('startBtn').textContent = resume ? 'Back to the track' : 'Start the race';
  $('resumeNote').textContent = resume ? `Race in progress: ${HUD.fmtClock(r.t)} elapsed, ${(r.dist / S.MILE).toFixed(2)} mi.` : '';
  const best = store.get(BEST_KEY);
  $('bestNote').textContent = best ? `Personal best: ${best.toFixed(2)} miles` : '';
  if (st.phase === 'pre') { drawPanel(['24 HOURS', 'Swing your arms to run.', 'Grip food on the aid table, lift it to your mouth.', 'Pull the trigger to start the race.']); }
}
$('startBtn').addEventListener('click', () => {
  sound.init();
  if (st.phase === 'pre') startCountdown();
  else $('start').classList.add('hidden');
});
$('menuBtn').addEventListener('click', () => { showStart(); });
$('newBtn').addEventListener('click', () => {
  if (st.phase === 'running' && !confirm('Abandon this race and start over? (DNF)')) return;
  newRace();
});
$('muteBtn').addEventListener('click', () => {
  sound.init();
  sound.setMuted(!sound.muted);
  $('muteBtn').textContent = sound.muted ? 'Sound: off' : 'Sound: on';
});

// VR button (only if WebXR immersive-vr is offered)
if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    const b = VRButton.createButton(renderer);
    b.id = 'vrBtn';
    b.removeAttribute('style');
    $('vrSlot').appendChild(b);
    $('vrSlot').classList.remove('hidden');
  }).catch(() => {});
}
renderer.xr.addEventListener('sessionstart', () => {
  sound.init();
  $('start').classList.add('hidden');
  if (st.phase === 'pre') { showStart(); $('start').classList.add('hidden'); panel.visible = true; panel.scale.setScalar(1); panel.position.y = 1.45; }
  if (st.phase === 'done') showResults();
});
renderer.xr.addEventListener('sessionend', () => {
  panel.visible = false;
  camera.position.set(0, 1.7, 0);
  showStart();
});

function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 88 : 72; // portrait phones need a taller view
  camera.updateProjectionMatrix();
}
fitCamera();
addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && st.phase === 'running') save(); });

// ---------------------------------------------------------------- boot
if (st.phase === 'running') {
  const gap = (Date.now() - st.savedAt) / 1000 * TS;
  if (gap > 2) processGap(gap);
}
showStart();
if (st.phase === 'done') { showResults(); $('start').classList.add('hidden'); }
renderer.setAnimationLoop(() => {
  update();
  renderer.render(scene, camera);
});

// debugging hook
// frames(n): advance n simulated 60fps frames synchronously (works with the tab hidden).
function frames(n, each) {
  for (let i = 0; i < n; i++) {
    clockSkew += 1 / 60;
    lastFrame -= 0; // keep dt = 1/60 relative to skewed clock
    each?.(i);
    update();
  }
  renderer.render(scene, camera);
}
window.__t24 = { get st() { return st; }, get down() { return down; }, get stumble() { return stumble; }, stride, S, trayEat, nearTable, processGap, frames, getUp };
