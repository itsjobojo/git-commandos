/**
 * Global clock. `scale` is how the game does hitstop, slow-mo on extraction,
 * and the death-cam ramp — every system reads dt from the loop, so nothing
 * else needs to know time is being bent.
 */
export const Time = {
  /** Seconds of simulated time since boot (already scaled). */
  elapsed: 0,
  /** Multiplier applied to real frame time. 1 = normal, 0 = frozen. */
  scale: 1,
  /** Real (unscaled) seconds since boot — for UI animation that must not freeze. */
  real: 0,
};

let stopUntil = 0;

/** Freeze the sim for `seconds` of real time. Used on impact. */
export function hitstop(seconds: number): void {
  stopUntil = Math.max(stopUntil, Time.real + seconds);
}

/** Called once per frame by the loop, before stepping. */
export function updateTimeScale(realDt: number, base = 1): void {
  Time.real += realDt;
  Time.scale = Time.real < stopUntil ? 0 : base;
}
