import type { Grid } from '../world/grid';
import { MUZZLE_OFFSET } from './weapons';

/**
 * Where the held weapon can actually put a round, this instant.
 *
 * Three distances rather than one, because the whole point of drawing spread is
 * the case where they disagree: hugging a corner with a shotgun, the left edge
 * clears it and the right edge buries itself in the wall. A single centre
 * length would draw that as "clear" and be wrong about the only thing the
 * player wanted to know.
 */
export interface AimEnvelope {
  muzzleX: number;
  muzzleZ: number;
  yaw: number;
  /** Half-angle of the spread, radians. Both edges sit this far off centre. */
  halfAngle: number;
  centre: number;
  left: number;
  right: number;
}

/**
 * The single source of truth for "where would this shot go".
 *
 * `CombatSystem` fires from it and the indicator draws from it, so the drawn
 * envelope is a promise the weapon actually keeps. Pure and grid-only — no
 * `Scene`, no `Player` — so it can be tested without a renderer.
 *
 * `yaw` must be the player's *body* facing, not the aim point: bullets leave
 * along `player.yaw`, which lags the cursor while the turn eases. Drawing from
 * the cursor would put the line somewhere the gun isn't pointing.
 */
export function aimEnvelope(
  grid: Pick<Grid, 'rayDistance'>,
  x: number,
  z: number,
  yaw: number,
  spread: number,
  /** How far to look — the weapon's sight length, not its lethal range. */
  reach: number,
  out: AimEnvelope = blankEnvelope(),
): AimEnvelope {
  const muzzleX = x + Math.cos(yaw) * MUZZLE_OFFSET;
  const muzzleZ = z + Math.sin(yaw) * MUZZLE_OFFSET;

  out.muzzleX = muzzleX;
  out.muzzleZ = muzzleZ;
  out.yaw = yaw;
  out.halfAngle = spread;
  // Cover blocks shots, so the shot lines clip on it — unlike eyes, which see
  // straight over it. Same tracer, deliberately different predicate.
  out.centre = cast(grid, muzzleX, muzzleZ, yaw, reach);
  out.left = cast(grid, muzzleX, muzzleZ, yaw - spread, reach);
  out.right = cast(grid, muzzleX, muzzleZ, yaw + spread, reach);
  return out;
}

/** A reusable envelope, so the render path allocates nothing per frame. */
export function blankEnvelope(): AimEnvelope {
  return { muzzleX: 0, muzzleZ: 0, yaw: 0, halfAngle: 0, centre: 0, left: 0, right: 0 };
}

function cast(
  grid: Pick<Grid, 'rayDistance'>,
  x: number,
  z: number,
  angle: number,
  reach: number,
): number {
  return grid.rayDistance(x, z, Math.cos(angle), Math.sin(angle), reach, true);
}
