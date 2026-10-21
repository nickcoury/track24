// Turns strides (from arm swings, taps, or keys) into a desired running speed.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Strides {
  constructor() {
    this.times = [];
    this.amps = [];
    this.lastSide = null;
  }
  get last() {
    return this.times.length ? this.times[this.times.length - 1] : -1e9;
  }
  // Returns true if this stride came from the same side as the previous one.
  add(side, amp, now, single = false) {
    const same = !single && side === this.lastSide && now - this.last < 1.2;
    if (single && this.times.length) {
      // One arm busy holding food: each swing of the free arm counts as a full stride pair.
      const mid = (this.last + now) / 2;
      if (now - this.last < 1.6) { this.times.push(mid); this.amps.push(amp); }
    }
    this.times.push(now);
    this.amps.push(amp);
    this.lastSide = side;
    while (this.times.length > 8) { this.times.shift(); this.amps.shift(); }
    return same;
  }
  // Strides per second, decaying as soon as you stop.
  cadence(now) {
    const n = this.times.length;
    if (n < 2) return 0;
    const gap = now - this.times[n - 1];
    if (gap > 1.6) return 0;
    const k = Math.min(n - 1, 4);
    const avg = (this.times[n - 1] - this.times[n - 1 - k]) / k;
    return 1 / Math.max(avg, gap, 0.22);
  }
  strideLength() {
    if (!this.amps.length) return 0.8;
    const a = this.amps.slice(-4).reduce((x, y) => x + y, 0) / Math.min(4, this.amps.length);
    return clamp(0.55 + a * 2.6, 0.55, 1.75);
  }
  targetSpeed(now) {
    return this.cadence(now) * this.strideLength();
  }
  reset() { this.times.length = 0; this.amps.length = 0; this.lastSide = null; }
}

// Detects the forward peak of a hand's running arm swing.
// Feed it the hand position relative to the head, projected onto the
// head's horizontal forward axis (f) and vertical (y).
export class ArmSwing {
  constructor(side) {
    this.side = side;
    this.prev = null;
    this.v = 0;
    this.travel = 0;
    this.forward = false;
    this.lastPeak = -1;
  }
  update(f, y, dt, now) {
    const c = f + 0.4 * y; // a running arm swings forward-and-up, back-and-down
    if (this.prev == null || dt <= 0) { this.prev = c; return null; }
    const raw = (c - this.prev) / dt;
    this.prev = c;
    this.v = this.v * 0.5 + raw * 0.5;
    if (this.v > 0.3) {
      this.forward = true;
      this.travel += this.v * dt;
    } else if (this.forward && this.v < -0.08) {
      this.forward = false;
      const amp = this.travel;
      this.travel = 0;
      if (amp > 0.07 && now - this.lastPeak > 0.2) {
        this.lastPeak = now;
        return amp;
      }
    } else if (!this.forward) {
      this.travel = 0;
    }
    return null;
  }
}
