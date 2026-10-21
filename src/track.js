// 400m standard track geometry. Runners go counterclockwise (infield on the
// left). s = 0 is the finish line at the end of the home straight.

export const STRAIGHT = 84.39;
export const R1 = 36.8;          // lane 1 measurement line radius
export const CURB = 36.5;
export const LANE_W = 1.22;
export const LANES = 8;
export const HALF = STRAIGHT / 2;
const ARC = Math.PI * R1;

// Position + heading at distance s along a line offset `off` meters outward
// from the lane-1 line. Heading is a unit vector (hx, hz).
export function trackPoint(s, off = 0) {
  const L = 2 * ARC + 2 * STRAIGHT;
  s = ((s % L) + L) % L;
  const r = R1 + off;
  if (s < ARC) {
    const th = Math.PI / 2 - s / R1;
    return { x: HALF + r * Math.cos(th), z: r * Math.sin(th), hx: Math.sin(th), hz: -Math.cos(th) };
  }
  s -= ARC;
  if (s < STRAIGHT) return { x: HALF - s, z: -r, hx: -1, hz: 0 };
  s -= STRAIGHT;
  if (s < ARC) {
    const th = -Math.PI / 2 - s / R1;
    return { x: -HALF + r * Math.cos(th), z: r * Math.sin(th), hx: Math.sin(th), hz: -Math.cos(th) };
  }
  s -= ARC;
  return { x: -HALF + s, z: r, hx: 1, hz: 0 };
}

// Point on the oval at radius r for loop parameter u in [0,1).
export function ovalPoint(u, r) {
  const L = 2 * Math.PI * r + 2 * STRAIGHT;
  let s = u * L;
  if (s < Math.PI * r) {
    const th = Math.PI / 2 - s / r;
    return [HALF + r * Math.cos(th), r * Math.sin(th)];
  }
  s -= Math.PI * r;
  if (s < STRAIGHT) return [HALF - s, -r];
  s -= STRAIGHT;
  if (s < Math.PI * r) {
    const th = -Math.PI / 2 - s / r;
    return [-HALF + r * Math.cos(th), r * Math.sin(th)];
  }
  s -= Math.PI * r;
  return [-HALF + s, r];
}

// Yaw for an object/camera whose forward (-z) should point along (hx, hz).
export function headingYaw(hx, hz) {
  return Math.atan2(-hx, -hz);
}
