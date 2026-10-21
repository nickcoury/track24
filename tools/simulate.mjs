// Simulate full 24h races with scripted "players" to tune the physiology.
// Usage: node tools/simulate.mjs
import * as S from '../src/sim.js';

let seed = 42;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function race({ label, pace, fadeTo = pace, eats = true, grabs = 2, catchRate = 0.85 }) {
  seed = 42;
  const r = S.newRunner();
  const rivals = S.newRivals();
  const dt = 1;
  let lastLap = 0, strideAcc = 0, downFor = 0;
  while (r.t < S.RACE_SECONDS) {
    const frac = r.t / S.RACE_SECONDS;
    let want = pace + (fadeTo - pace) * frac;
    if (downFor > 0) { downFor -= dt; want = 0; }
    S.step(r, dt, want, rng);
    S.stepRivals(rivals, r.t, dt);
    // Stumbles: ~2.4 strides/s at running speed.
    strideAcc += r.speed / 1.2 * dt;
    while (strideAcc >= 1) {
      strideAcc -= 1;
      if (rng() < S.stumbleChance(r) && rng() > catchRate) { S.fall(r); downFor = 12; }
    }
    const lap = Math.floor(r.dist / S.TRACK_LEN);
    if (eats && lap > lastLap) {
      lastLap = lap;
      // One drink + up to (grabs-1) food items per pass of the table.
      if (r.water > 200) S.eat(r, r.sodium > 1200 ? 'electro' : 'water');
      if (grabs > 2 && r.water > 500) S.eat(r, 'water');
      for (let g = 1; g < grabs; g++) {
        const room = S.STOMACH_CAP * 0.6 - S.stomachLoad(r);
        let pick = null;
        if (r.energy + r.stomachKcal < 1750 && room > 120) pick = ['gel', 'pbj', 'banana', 'gummies'][(lap + g) % 4];
        else if (r.sodium > 1800 && room > 60) pick = S.isNight(r.t) ? 'broth' : 'potato';
        else if (S.drowsiness(r) > 0.4 && r.caffeine < 150) pick = S.isNight(r.t) ? 'coffee' : 'cola';
        if (pick) S.eat(r, pick);
      }
    }
    r.events.length = 0;
  }
  const mi = r.dist / S.MILE;
  const riv = rivals.map(x => (x.dist / S.MILE).toFixed(0)).join(' ');
  console.log(`${label.padEnd(26)} ${mi.toFixed(1).padStart(6)} mi | energy ${r.energy.toFixed(0).padStart(4)} legs ${r.legs.toFixed(0).padStart(3)} water ${r.water.toFixed(0).padStart(5)} na ${r.sodium.toFixed(0).padStart(5)} falls ${r.falls} ate ${r.kcalEaten} | rivals ${riv}`);
}

race({ label: 'no food, steady 2.4', pace: 2.4, eats: false });
race({ label: 'casual 1.9 m/s', pace: 1.9 });
race({ label: 'good 2.4 m/s', pace: 2.4 });
race({ label: 'good 2.6 -> 2.0', pace: 2.6, fadeTo: 2.0 });
race({ label: 'hard 3.6 m/s', pace: 3.6, grabs: 3 });
race({ label: 'elite 4.0 -> 3.6', pace: 4.0, fadeTo: 3.6, grabs: 3, catchRate: 0.95 });
race({ label: 'reckless 5.0', pace: 5.0, grabs: 3 });
