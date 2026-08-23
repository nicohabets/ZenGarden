export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private started = false;
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  async ensure(): Promise<void> {
    if (this.muted || this.started) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    this.patch();
    this.master.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 2.4);
    this.started = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.22, this.ctx.currentTime + 0.25);
  }

  rakeTick(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.value = 180 + Math.random() * 40;
    f.type = "lowpass";
    f.frequency.value = 420;
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  private patch(): void {
    if (!this.ctx || !this.master) return;
    const noise = this.brownNoise();
    const src = this.ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.35;
    src.connect(filter);
    filter.connect(ng);
    ng.connect(this.master);
    src.start();

    this.pad(146.8, 0.035);
    this.pad(196.0, 0.028);
    this.scheduleChime();
  }

  private pad(freq: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(this.master);
    osc.start();
  }

  private scheduleChime(): void {
    if (!this.ctx || !this.master) return;
    const notes = [293.66, 329.63, 392.0, 440.0, 523.25];
    const wait = 7 + Math.random() * 11;
    window.setTimeout(() => {
      if (!this.ctx || !this.master || this.muted) {
        this.scheduleChime();
        return;
      }
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[Math.floor(Math.random() * notes.length)];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 2);
      this.scheduleChime();
    }, wait * 1000);
  }

  private brownNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }
}
