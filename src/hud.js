// Canvas drawing for the wrist watch, body panel, scoreboard and race clock.
import * as S from './sim.js';

export function fmtClock(sec, withSec = true) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return withSec ? `${h}:${mm}:${ss}` : `${h}:${mm}`;
}

export function fmtTimeOfDay(t) {
  const h = S.hourOfDay(t);
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}

export function fmtPace(speed) {
  if (speed < 0.3) return '--:--';
  const spm = S.MILE / speed;
  if (spm > 3600) return '--:--';
  return `${Math.floor(spm / 60)}:${String(Math.floor(spm % 60)).padStart(2, '0')}`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// GPS watch face (512x512).
export function drawWatch(c, r, extra = {}) {
  const g = c.getContext('2d');
  const W = c.width;
  g.clearRect(0, 0, W, W);
  g.fillStyle = '#111';
  roundRect(g, 0, 0, W, W, 90); g.fill();
  g.fillStyle = '#05080c';
  roundRect(g, 18, 18, W - 36, W - 36, 74); g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#7fd1ff';
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillText(`${fmtTimeOfDay(r.t)}  ·  LAP ${Math.floor(r.dist / S.TRACK_LEN) + 1}`, W / 2, 80);
  g.fillStyle = '#fff';
  g.font = 'bold 104px system-ui, sans-serif';
  g.fillText(fmtClock(r.t), W / 2, 190);
  g.fillStyle = '#ffd23f';
  g.font = 'bold 96px system-ui, sans-serif';
  g.fillText(`${(r.dist / S.MILE).toFixed(2)} mi`, W / 2, 300);
  g.fillStyle = '#ccc';
  g.font = 'bold 50px system-ui, sans-serif';
  g.fillText(`${fmtPace(r.speed)} /mi   ♥ ${S.heartRate(r)}`, W / 2, 380);
  if (extra.note) {
    g.fillStyle = extra.noteColor || '#ff6b6b';
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillText(extra.note, W / 2, 452);
  } else {
    g.fillStyle = '#7fd1ff';
    g.font = '40px system-ui, sans-serif';
    const left = S.RACE_SECONDS - r.t;
    g.fillText(`${fmtClock(left, false)} to go`, W / 2, 452);
  }
}

export function bodyBars(r) {
  const water = r.water;
  return [
    { label: 'ENERGY', v: r.energy / S.ENERGY_MAX, warn: r.energy < 400 },
    { label: water < -800 ? 'SLOSHY' : 'HYDRATION', v: water < -800 ? 0.5 : 1 - Math.max(0, water) / 3500, warn: water > 1500 || water < -1300 },
    { label: 'STOMACH', v: S.stomachLoad(r) / S.STOMACH_CAP, warn: S.stomachLoad(r) > 0.8 * S.STOMACH_CAP, invert: true },
    { label: 'LEGS', v: 1 - r.legs / 100, warn: r.legs > 70 },
    { label: 'SALT', v: 1 - Math.max(0, r.sodium) / 4000, warn: r.sodium > 2500 },
    { label: 'ALERT', v: 1 - S.drowsiness(r), warn: S.drowsiness(r) > 0.55 },
  ];
}

function barColor(b) {
  const v = b.invert ? 1 - b.v : b.v;
  if (b.warn) return '#ff5a4f';
  if (v < 0.45) return '#ffb020';
  return '#3ddc84';
}

// Body status panel (512x512).
export function drawBody(c, r) {
  const g = c.getContext('2d');
  const W = c.width;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(8,14,24,0.92)';
  roundRect(g, 0, 0, W, W, 40); g.fill();
  const bars = bodyBars(r);
  g.font = 'bold 34px system-ui, sans-serif';
  bars.forEach((b, i) => {
    const y = 30 + i * 78;
    g.fillStyle = b.warn ? '#ff8a80' : '#cfd8e3';
    g.textAlign = 'left';
    g.fillText(b.label, 26, y + 32);
    g.fillStyle = '#1b2533';
    roundRect(g, 26, y + 44, W - 52, 22, 11); g.fill();
    g.fillStyle = barColor(b);
    roundRect(g, 26, y + 44, Math.max(22, (W - 52) * Math.max(0, Math.min(1, b.v))), 22, 11); g.fill();
  });
}

export function drawRaceClock(c, r, phase) {
  const g = c.getContext('2d');
  g.fillStyle = '#050505';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = phase === 'done' ? '#3ddc84' : '#ff2a2a';
  g.font = 'bold 190px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(fmtClock(r.t), c.width / 2, c.height / 2 + 8);
}

export function drawScoreboard(c, r, rivals, phase) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = '#04070d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffd23f';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText('24 HOUR TRACK CHAMPIONSHIP', 24, 52);
  g.textAlign = 'right';
  g.fillStyle = '#ff3b30';
  g.font = 'bold 46px "Courier New", monospace';
  g.fillText(fmtClock(r.t), W - 24, 54);
  g.fillStyle = '#7fd1ff';
  g.font = '28px system-ui, sans-serif';
  g.fillText(`${fmtTimeOfDay(r.t)}   ${Math.round(S.temperatureC(r.t) * 9 / 5 + 32)}°F`, W - 24, 92);
  g.textAlign = 'left';
  g.fillText(phase === 'done' ? 'FINAL RESULTS' : 'LIVE STANDINGS', 24, 92);
  const rows = [{ name: 'YOU', dist: r.dist, bib: 1, you: true }, ...rivals].sort((a, b) => b.dist - a.dist);
  g.font = 'bold 34px system-ui, sans-serif';
  rows.forEach((row, i) => {
    const y = 150 + i * 44;
    if (row.you) { g.fillStyle = '#1d3b66'; g.fillRect(14, y - 32, W - 28, 42); }
    g.fillStyle = row.you ? '#ffd23f' : '#e8eef6';
    g.textAlign = 'left';
    g.fillText(`${i + 1}.`, 26, y);
    g.fillText(`#${row.bib}`, 80, y);
    g.fillText(row.name.toUpperCase(), 180, y);
    g.textAlign = 'right';
    g.fillText(`${Math.floor(row.dist / S.TRACK_LEN)} laps`, W - 230, y);
    g.fillText(`${(row.dist / S.MILE).toFixed(1)} mi`, W - 26, y);
  });
}

// Speech bubble texture
export function drawBubble(c, text) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = 'bold 54px system-ui, sans-serif';
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > c.width - 60 && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  const h = 30 + lines.length * 62;
  g.fillStyle = '#ffffff';
  roundRect(g, 4, c.height - h - 34, c.width - 8, h, 30); g.fill();
  g.beginPath();
  g.moveTo(c.width / 2 - 20, c.height - 36);
  g.lineTo(c.width / 2, c.height - 4);
  g.lineTo(c.width / 2 + 20, c.height - 36);
  g.fill();
  g.fillStyle = '#111';
  g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height - h - 34 + 66 + i * 62));
}

// ---- what the crowd says ----
const pick = (a) => a[(Math.random() * a.length) | 0];

export function crowdLine(r, ctx) {
  const st = S.status(r);
  const mi = r.dist / S.MILE;
  if (ctx.fallen) return pick(['GET UP!', 'Oh no. Oh no. Get up!', 'You\'re okay! You\'re okay!', 'That looked like it hurt!']);
  if (st.includes('bonked')) return pick(['EAT SOMETHING!', 'You look like you need a sandwich!', 'Go to the aid station!', 'You\'re running on fumes!']);
  if (st.includes('very-dehydrated')) return pick(['DRINK SOME WATER!', 'Hydrate!!', 'You look parched!']);
  if (st.includes('nauseous')) return pick(['You\'ve got this... maybe walk a bit.', 'Little sips!', 'Better out than in!']);
  if (st.includes('cramping')) return pick(['Walk it off!', 'Salt! You need salt!', 'Shake it out!']);
  if (st.includes('sleepy')) return pick(['Stay awake!', 'Eyes open!', 'Coffee\'s at the table!', 'No sleeping on the track!']);
  if (st.includes('low-salt')) return pick(['Have a pickle!', 'Salt potatoes!', 'Electrolytes!']);
  if (r.speed > 4.3 && r.t < 4 * 3600) return pick(['Whoa, save some for later!', 'It\'s a 24 hour race, buddy!', 'Easy, champ! Long day!']);
  if (r.speed > 3.4) return pick(['Looking STRONG!', 'Smooth stride!', 'You\'re flying!', 'Beautiful form!']);
  if (r.speed < 0.3) return pick(['Keep moving!', 'Relentless forward progress!', 'Beware the chair!', 'Just one more lap!']);
  if (S.isNight(r.t)) return pick(['Still out here! Legend!', 'You\'re a machine!', 'The sun\'s coming back, I promise!', 'Night shift!']);
  if (mi > 80) return pick(['That\'s a LOT of laps!', 'Absolute unit!', 'Hero!', 'How are you still moving?!']);
  return pick(['Go go go!', 'Looking good!', 'Nice work, runner!', 'Lap ' + (Math.floor(r.dist / S.TRACK_LEN) + 1) + '!', 'You got this!', 'Way to go!', 'Woooo!']);
}

export function volunteerLine(r) {
  const st = S.status(r);
  if (st.includes('low-energy') || st.includes('bonked')) return pick(['You need calories. Grab something!', 'Gel? PB&J? Anything?']);
  if (st.includes('dehydrated') || st.includes('very-dehydrated')) return pick(['Water! Grab a cup!', 'Drink something, please.']);
  if (st.includes('low-salt')) return pick(['Pickles are fresh!', 'Salt potatoes, hot!']);
  if (st.includes('sleepy')) return pick(['Fresh coffee!', 'Cola has caffeine!']);
  if (S.isNight(r.t)) return pick(['Broth is hot!', 'Coffee\'s on!', 'What can I get you?']);
  return pick(['What do you need?', 'Water, electrolyte, cola!', 'Pizza just arrived!', 'You\'re doing great!', 'Grab and go!']);
}

const MILESTONES = [
  [26.2, 'a marathon'], [31.07, '50 kilometers'], [50, '50 miles'], [62.14, '100 kilometers'],
  [100, '100 miles'], [124.27, '200 kilometers'], [150, '150 miles'], [200, '200 miles'],
];
export function milestone(prevMi, mi) {
  for (const [m, name] of MILESTONES) if (prevMi < m && mi >= m) return name;
  if (Math.floor(prevMi / 10) < Math.floor(mi / 10)) return `${Math.floor(mi / 10) * 10} miles`;
  return null;
}

export const PA_LINES = [
  'Attention runners. The pierogies are now hot at the aid station.',
  'A reminder that the course is the same as it was last lap.',
  'Will the owner of a blue camp chair please stop sitting in it.',
  'Runners are reminded that the chair is not your friend.',
  'Lost and found currently has one shoe. Left foot. Very damp.',
  'Course conditions: flat. Oval. Unchanged.',
  'Runners, please remember to look where you are going. It is a circle.',
  'Fresh quesadillas in approximately forty minutes. That is about eight laps.',
  'Crew members, please do not hand your runner a pizza at speed.',
];
