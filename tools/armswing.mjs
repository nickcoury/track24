// Feed the arm-swing detector synthetic running arm motion (plus headset jitter)
// and check the resulting stride rate and speed.
import { ArmSwing, Strides } from '../src/input.js';

function run(label, hz, amp, seconds = 10, fps = 72, noise = 0.004) {
  const L = new ArmSwing('left'), R = new ArmSwing('right');
  const s = new Strides();
  let count = 0, speed = 0, same = 0;
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps, dt = 1 / fps;
    for (const [arm, ph] of [[L, 0], [R, Math.PI]]) {
      const f = 0.25 + amp / 2 * Math.sin(2 * Math.PI * hz * t + ph) + (Math.random() - 0.5) * noise;
      const y = -0.35 + amp / 4 * Math.sin(2 * Math.PI * hz * t + ph) + (Math.random() - 0.5) * noise;
      const a = arm.update(f, y, dt, t);
      if (a != null) { count++; if (s.add(arm.side, a, t)) same++; }
    }
    if (t > seconds - 1) speed = s.targetSpeed(t);
  }
  console.log(`${label.padEnd(30)} strides/s ${(count / seconds).toFixed(2)}  speed ${speed.toFixed(2)} m/s  same-side ${same}`);
}
run('walk: 0.8 Hz, 15cm', 0.8, 0.15);
run('jog: 1.2 Hz, 25cm', 1.2, 0.25);
run('run: 1.5 Hz, 35cm', 1.5, 0.35);
run('hard: 1.6 Hz, 45cm', 1.6, 0.45);
run('tiny jitter only', 1.4, 0.0);
run('jog with sloppy tracking', 1.2, 0.25, 10, 72, 0.02);
