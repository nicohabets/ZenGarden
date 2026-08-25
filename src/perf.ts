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
  private warmup = 0;

  markReady(startedAt: number): void {
    this.readyMs = Math.max(0, performance.now() - startedAt);
  }

  sample(): void {
    const now = performance.now();
    this.frames += 1;
    if (this.last > 0) {
      this.lastMs = now - this.last;
      this.warmup += 1;
      // Two discarded frames is enough; eight left CI waiting past 12s
      // on SwiftShader before samples existed.
      if (this.warmup > 2) {
        this.samples.push(this.lastMs);
        if (this.samples.length > 48) this.samples.shift();
      }
    }
    this.last = now;
  }

  shouldPublish(): boolean {
    return this.frames % 12 === 0;
  }

  stats(simW: number, simH: number, shadows: boolean): PerfStats {
    const avg = trimmedMean(this.samples);
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

function trimmedMean(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.2);
  const slice = sorted.slice(cut, sorted.length - cut || sorted.length);
  const use = slice.length ? slice : sorted;
  let sum = 0;
  for (const v of use) sum += v;
  return sum / use.length;
}
