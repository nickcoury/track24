// Race physiology + race model. Pure JS, no DOM or three.js, so it can be
// unit-simulated in Node (see tools/simulate.mjs).

export const MILE = 1609.344;
export const TRACK_LEN = 400;
export const RACE_SECONDS = 24 * 3600;
export const RACE_START_HOUR = 9; // gun goes off at 9:00 AM

export const ENERGY_MAX = 2000;      // kcal of readily available fuel
export const STOMACH_CAP = 900;      // "load" units (bulk + 0.6 * ml)
export const KCAL_PER_METER = 100 / MILE; // 100 kcal per mile

// Aid station menu. bulk = how much room it takes in the stomach.
export const FOODS = {
  water:    { name: 'Water',          kcal: 0,   ml: 150, na: 0,   caf: 0,  bulk: 0 },
  electro:  { name: 'Electrolyte',    kcal: 35,  ml: 150, na: 160, caf: 0,  bulk: 0 },
  cola:     { name: 'Cola',           kcal: 60,  ml: 150, na: 6,   caf: 14, bulk: 0 },
  coffee:   { name: 'Coffee',         kcal: 5,   ml: 120, na: 0,   caf: 90, bulk: 0, night: true },
  broth:    { name: 'Chicken Broth',  kcal: 15,  ml: 200, na: 480, caf: 0,  bulk: 0, night: true },
  banana:   { name: 'Banana',         kcal: 105, ml: 0,   na: 1,   caf: 0,  bulk: 110 },
  gel:      { name: 'Energy Gel',     kcal: 100, ml: 0,   na: 60,  caf: 0,  bulk: 35 },
  pbj:      { name: 'PB&J Quarter',   kcal: 95,  ml: 0,   na: 80,  caf: 0,  bulk: 85 },
  potato:   { name: 'Salted Potato',  kcal: 45,  ml: 0,   na: 260, caf: 0,  bulk: 55 },
  pickle:   { name: 'Pickle Spear',   kcal: 5,   ml: 20,  na: 420, caf: 0,  bulk: 25 },
  gummies:  { name: 'Gummy Bears',    kcal: 85,  ml: 0,   na: 6,   caf: 0,  bulk: 30 },
  pizza:    { name: 'Pizza Slice',    kcal: 285, ml: 0,   na: 640, caf: 0,  bulk: 280 },
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function hourOfDay(t) {
  return (RACE_START_HOUR + t / 3600) % 24;
}

export function isNight(t) {
  const h = hourOfDay(t);
  return h >= 19.75 || h < 6.5;
}

// Ambient temperature (C): peaks ~3pm, bottoms ~4am.
export function temperatureC(t) {
  const h = hourOfDay(t);
  return 14 + 9 * Math.cos(((h - 15) / 24) * Math.PI * 2);
}

export function newRunner() {
  return {
    t: 0,              // race seconds elapsed
    dist: 0,           // meters
    speed: 0,          // m/s
    energy: 1800,      // kcal available (carbo-loaded, not full)
    stomachKcal: 0,
    stomachMl: 0,
    stomachBulk: 0,
    water: 0,          // body water deficit, ml (negative = overhydrated)
    sodium: 0,         // sodium deficit, mg
    caffeine: 0,       // mg in system
    legs: 0,           // muscle damage 0..100
    kcalEaten: 0,
    mlDrunk: 0,
    falls: 0,
    cramp: 0,          // seconds of cramp remaining
    nausea: 0,         // seconds of nausea remaining
    events: [],        // drained by the game each frame
  };
}

export function stomachLoad(r) {
  return r.stomachBulk + 0.6 * r.stomachMl;
}

export function drowsiness(r) {
  const h = hourOfDay(r.t);
  const awake = 3 + r.t / 3600; // woke at 6am
  const pressure = clamp((awake - 14) / 16, 0, 1);
  const dh = ((h - 4 + 36) % 24) - 12; // hours from 4am
  const circadian = 0.55 * Math.exp(-(dh * dh) / (2 * 2.6 * 2.6));
  const caf = Math.min(0.5, r.caffeine / 220);
  return clamp(pressure * 0.6 + circadian - caf, 0, 1);
}

// Fastest the body will currently allow, m/s.
export function maxSpeed(r) {
  let v = 6.2 * (1 - 0.5 * r.legs / 100);
  if (r.energy < 400) v *= 0.4 + 0.6 * (r.energy / 400);
  if (r.energy < 120) v = Math.min(v, 1.3); // full bonk: death march
  if (r.water > 1500) v *= 1 - clamp((r.water - 1500) / 3000, 0, 0.5);
  if (r.water < -1300) v *= 0.8; // sloshing, hyponatremic
  if (stomachLoad(r) > 0.8 * STOMACH_CAP) v *= 0.75;
  if (r.nausea > 0) v *= 0.7;
  if (r.cramp > 0) v = Math.min(v, 1.2);
  v *= 1 - 0.22 * drowsiness(r);
  const T = temperatureC(r.t);
  if (T > 21) v *= 1 - (T - 21) * 0.012;
  return Math.max(0.6, v);
}

export function status(r) {
  const out = [];
  if (r.energy < 120) out.push('bonked');
  else if (r.energy < 400) out.push('low-energy');
  if (r.water > 2500) out.push('very-dehydrated');
  else if (r.water > 1500) out.push('dehydrated');
  if (r.water < -1300) out.push('overhydrated');
  if (stomachLoad(r) > 0.8 * STOMACH_CAP) out.push('stuffed');
  if (r.nausea > 0) out.push('nauseous');
  if (r.cramp > 0) out.push('cramping');
  if (r.sodium > 2500) out.push('low-salt');
  if (drowsiness(r) > 0.55) out.push('sleepy');
  if (r.legs > 70) out.push('trashed-legs');
  return out;
}

// Chance that a single stride catches a toe.
export function stumbleChance(r) {
  return 0.00025
    + 0.004 * (r.legs / 100) ** 2
    + 0.008 * drowsiness(r) ** 2
    + (r.energy < 300 ? 0.004 : 0)
    + (r.speed > 4 ? 0.001 : 0);
}

export function heartRate(r) {
  return Math.round(58 + r.speed * 24 + clamp(r.water / 100, 0, 25)
    + (temperatureC(r.t) - 14) * 0.8 + r.legs * 0.1);
}

// frac < 1 when some of it ended up on your shirt.
export function eat(r, key, frac = 1) {
  const f = FOODS[key];
  if (!f) return;
  r.stomachKcal += f.kcal * frac;
  r.stomachMl += f.ml * frac;
  r.stomachBulk += f.bulk;
  r.sodium = Math.max(-1500, r.sodium - f.na);
  r.caffeine += f.caf;
  r.kcalEaten += Math.round(f.kcal * frac);
  r.mlDrunk += Math.round(f.ml * frac);
  r.events.push({ type: 'eat', key });
  if (stomachLoad(r) > STOMACH_CAP) {
    // Too much, too fast. Everything comes back up.
    r.stomachKcal = 0; r.stomachMl = 0; r.stomachBulk = 0;
    r.water += 300;
    r.nausea = 240;
    r.events.push({ type: 'vomit' });
  }
}

export function fall(r) {
  r.falls++;
  r.legs = Math.min(100, r.legs + 0.6);
  r.speed = 0;
  r.events.push({ type: 'fall' });
}

// Advance the runner by dt seconds, trying to move at desiredSpeed.
// rng lets the Node simulation be deterministic.
export function step(r, dt, desiredSpeed, rng = Math.random) {
  const vmax = maxSpeed(r);
  const target = Math.min(desiredSpeed, vmax);
  // Momentum: easy to slow a little, hard to stop dead.
  const accel = target > r.speed ? 0.9 : 1.4;
  r.speed += clamp(target - r.speed, -accel * dt, accel * dt);
  if (target < 0.02 && r.speed < 0.02) r.speed = 0;

  const prevLap = Math.floor(r.dist / TRACK_LEN);
  const d = r.speed * dt;
  r.dist += d;
  r.t += dt;
  const lap = Math.floor(r.dist / TRACK_LEN);
  if (lap > prevLap) r.events.push({ type: 'lap', lap });

  // --- Fuel ---
  const intensity = clamp((r.speed - 1.5) / 3, 0, 1);
  const burn = 75 / 3600 * dt + KCAL_PER_METER * d * (1 + 0.12 * Math.max(0, r.speed - 3.2));
  const fatIncome = (200 / 3600) * dt * (r.speed < 4.2 ? 1 : 0.6);
  const absorbMax = (800 / 3600) * dt * (1 - 0.25 * intensity) * (r.nausea > 0 ? 0.4 : 1);
  const absorbed = Math.min(r.stomachKcal, absorbMax);
  r.stomachKcal -= absorbed;
  r.stomachBulk = Math.max(0, r.stomachBulk - (absorbed / Math.max(1, absorbed + r.stomachKcal)) * r.stomachBulk);
  if (r.stomachKcal <= 0.5) r.stomachBulk = Math.max(0, r.stomachBulk - 200 / 3600 * dt);
  r.energy = clamp(r.energy - burn + fatIncome + absorbed, 0, ENERGY_MAX);

  // --- Water + salt ---
  const T = temperatureC(r.t);
  const heat = clamp(0.55 + (T - 10) * 0.045, 0.45, 1.3);
  const sweatMl = (0.2 + 0.18 * r.speed) * heat * 1000 / 3600 * dt;
  r.water += sweatMl;
  r.sodium += sweatMl * 0.9;
  const drink = Math.min(r.stomachMl, 1250 / 3600 * dt);
  r.stomachMl -= drink;
  r.water -= drink;
  if (r.water < 0) r.water = Math.min(0, r.water + 350 / 3600 * dt); // kidneys

  // --- Legs ---
  r.legs = Math.min(100, r.legs + (d / 1000) * 0.17 * (r.speed / 3.2) ** 1.6);
  if (r.speed < 0.3) r.legs = Math.max(0, r.legs - 1.5 / 3600 * dt);

  // --- Misc ---
  r.caffeine *= Math.pow(0.5, dt / (5 * 3600));
  r.nausea = Math.max(0, r.nausea - dt);
  r.cramp = Math.max(0, r.cramp - dt);
  if (r.cramp <= 0 && r.speed > 1 && r.sodium > 2500) {
    const pPerMin = (r.sodium - 2500) / 25000 + r.legs / 4000;
    if (rng() < pPerMin * dt / 60) {
      r.cramp = 25 + rng() * 35;
      r.events.push({ type: 'cramp' });
    }
  }
}

// --- Other runners on the track ---------------------------------------
export const RIVALS = [
  { name: 'M. Okonkwo',        pace: 3.55, fade: 0.30, bib: 7 },
  { name: 'Yuki Tanabe',       pace: 3.25, fade: 0.22, bib: 18 },
  { name: 'Sven Ekdahl',       pace: 3.05, fade: 0.25, bib: 31 },
  { name: 'Priya Raman',       pace: 2.85, fade: 0.18, bib: 44 },
  { name: 'D. "Grizzly" Pruitt', pace: 2.75, fade: 0.32, bib: 52 },
  { name: 'Hank Bellweather (71)', pace: 2.05, fade: 0.08, bib: 63 },
  { name: 'Guy In Sandals',    pace: 2.6,  fade: 0.40, bib: 88 },
];

export function newRivals(seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return RIVALS.map((p, i) => ({
    ...p, i, dist: 0, speed: 0, stop: 0, seed: Math.floor(rnd() * 1e6),
    napDone: false,
  }));
}

function rivalRand(rv) {
  rv.seed = (rv.seed * 16807) % 2147483647;
  return rv.seed / 2147483647;
}

export function stepRivals(rivals, t, dt) {
  for (const rv of rivals) {
    if (rv.stop > 0) {
      rv.stop -= dt;
      rv.speed = Math.max(0, rv.speed - 2 * dt);
    } else {
      const frac = t / RACE_SECONDS;
      let v = rv.pace * (1 - rv.fade * frac);
      if (isNight(t)) v *= 0.93;
      rv.speed += clamp(v - rv.speed, -1.5 * dt, 1.0 * dt);
      // Aid station pauses, and a nap for some in the small hours.
      if (rivalRand(rv) < dt / 2400) rv.stop = 40 + rivalRand(rv) * 240;
      const h = hourOfDay(t);
      if (!rv.napDone && h > 2 && h < 5 && rv.fade > 0.2 && rivalRand(rv) < dt / 3600) {
        rv.stop = 900 + rivalRand(rv) * 1800;
        rv.napDone = true;
      }
    }
    rv.dist += rv.speed * dt;
  }
}

export function buckle(miles) {
  if (miles >= 200) return 'Legendary (200+)';
  if (miles >= 150) return 'Platinum';
  if (miles >= 100) return '100-Mile Buckle';
  if (miles >= 62.1) return '100K Finisher';
  if (miles >= 50) return '50-Mile Finisher';
  if (miles >= 26.2) return 'Marathoner (technically)';
  return 'Participant';
}
