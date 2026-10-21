// Small synthesized sound kit. Everything is generated; no audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastSpeak = 0;
  }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Crowd bed: looping filtered noise whose gain we ride.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
    // Night crickets
    this.cricketGain = this.ctx.createGain();
    this.cricketGain.gain.value = 0;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 4400;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.5;
    const am = this.ctx.createGain();
    am.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    osc.connect(am).connect(this.cricketGain).connect(this.master);
    osc.start(); lfo.start();
  }
  get ok() { return this.ctx && !this.muted && this.ctx.state === 'running'; }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  burst({ dur = 0.08, freq = 200, type = 'lowpass', q = 1, vol = 0.3, when = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  tone({ freq = 440, dur = 0.15, type = 'sine', vol = 0.2, when = 0, slide = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  step(speed) {
    const v = Math.min(1, 0.25 + speed / 5);
    this.burst({ dur: 0.07, freq: 160, vol: 0.35 * v });
    this.burst({ dur: 0.04, freq: 2500, type: 'highpass', vol: 0.05 * v });
  }
  breath(effort) {
    this.burst({ dur: 0.25 + effort * 0.15, freq: 700, type: 'bandpass', q: 0.8, vol: 0.03 + effort * 0.08 });
  }
  chomp() {
    for (let i = 0; i < 3; i++) this.burst({ dur: 0.05, freq: 1400, type: 'bandpass', q: 2, vol: 0.4, when: i * 0.13 });
  }
  gulp() {
    this.tone({ freq: 180, dur: 0.12, vol: 0.35, slide: -80 });
    this.tone({ freq: 160, dur: 0.12, vol: 0.3, slide: -70, when: 0.22 });
  }
  beep() {
    this.tone({ freq: 2093, dur: 0.07, type: 'square', vol: 0.06 });
    this.tone({ freq: 2637, dur: 0.09, type: 'square', vol: 0.06, when: 0.09 });
  }
  thud() {
    this.burst({ dur: 0.4, freq: 120, vol: 0.9 });
    this.burst({ dur: 0.25, freq: 900, type: 'bandpass', vol: 0.3, when: 0.05 });
  }
  whoa() {
    this.burst({ dur: 0.12, freq: 220, vol: 0.5 });
    this.tone({ freq: 520, dur: 0.25, type: 'triangle', vol: 0.12, slide: 200 });
  }
  horn() {
    this.tone({ freq: 233, dur: 1.4, type: 'sawtooth', vol: 0.18 });
    this.tone({ freq: 349, dur: 1.4, type: 'sawtooth', vol: 0.12 });
  }
  blech() {
    this.tone({ freq: 300, dur: 0.9, type: 'sawtooth', vol: 0.15, slide: -220 });
    this.burst({ dur: 0.7, freq: 500, type: 'bandpass', vol: 0.4, when: 0.15 });
  }
  cheer(level = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.12 + 0.25 * level, t + 0.3);
    g.linearRampToValueAtTime(this.crowdBase || 0.02, t + 2.8);
  }
  ambience(crowd, crickets) {
    if (!this.ok) return;
    this.crowdBase = crowd;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(crowd, t, 1.5);
    this.cricketGain.gain.setTargetAtTime(crickets * 0.012, t, 2);
  }

  speak(text, { pitch = 1, rate = 1.05, volume = 1 } = {}) {
    if (this.muted || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch; u.rate = rate; u.volume = volume;
      window.speechSynthesis.speak(u);
    } catch { /* not available in this browser */ }
  }
}
