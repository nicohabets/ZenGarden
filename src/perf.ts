export interface PerfStats {
  fps: number;
  frameMs: number;
  avgFrameMs: number;
  readyMs: number;
  plantMs: number;
  simW: number;
  simH: number;
  shadows: boolean;
  samples: number;
}

/** Rolling frame-time window for the Playwright API and data attributes. */
export class FrameMeter {
  readyMs = 0;
  plantMs = 0;
  private last = 0;
  private lastMs = 0;
  private readonly samples: number[] = [];
  private frames = 0;

  markReady(startedAt: number): void {
    this.readyMs = Math.max(0, performance.now() - startedAt);
  }

  sample(): void {
    const now = performance.now();
    if (this.last > 0) {
      this.lastMs = now - this.last;
      this.samples.push(this.lastMs);
      if (this.samples.length > 48) this.samples.shift();
    }
    this.last = now;
    this.frames += 1;
  }

  shouldPublish(): boolean {
    return this.frames % 12 === 0;
  }

  stats(simW: number, simH: number, shadows: boolean): PerfStats {
    const avg = average(this.samples);
    const frameMs = this.lastMs || avg;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs,
      avgFrameMs: avg,
      readyMs: this.readyMs,
      plantMs: this.plantMs,
      simW,
      simH,
      shadows,
      samples: this.samples.length,
    };
  }
}

function average(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
