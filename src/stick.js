/**
 * Screen-relative joystick for heading-steered vehicles (helicopter, submarine).
 * The camera always looks from +x,+z, so "up" on the stick is world (-1,0,-1) and "right" is (1,0,-1).
 * Push the stick where you want to go on screen: the vehicle turns toward that direction and
 * throttles up as it comes around (no thrust while it's still facing the wrong way).
 * Returns { pitch, yaw } contributions in -1..1, both 0 when the stick is centred.
 */
export function stickToHeading(input, yaw, turnSharpness = 0.6) {
  const ax = input.axisX || 0, ay = input.axisY || 0;
  const mag = Math.min(1, Math.hypot(ax, ay));
  if (mag < 0.01) return { pitch: 0, yaw: 0 };
  const wx = (ax - ay) * Math.SQRT1_2;   // screenRight * ax + screenUp * ay
  const wz = (-ax - ay) * Math.SQRT1_2;
  let err = Math.atan2(wx, wz) - yaw;
  err = Math.atan2(Math.sin(err), Math.cos(err));            // wrap to -π..π
  const turn = Math.max(-1, Math.min(1, err / turnSharpness)); // full rate until nearly aligned
  const facing = Math.max(0, Math.cos(err));                  // 1 when aligned, 0 at 90° or more
  return { pitch: mag * facing * facing, yaw: turn };
}
