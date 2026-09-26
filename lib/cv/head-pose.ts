/**
 * Head orientation from MediaPipe's facial transformation matrix
 * (4x4 canonical-face-to-camera transform), with a landmark fallback.
 */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

const RAD = 180 / Math.PI;

/**
 * Extracts yaw/pitch/roll (degrees) from a flattened 4x4 matrix. MediaPipe
 * returns column-major data (translation in elements 12-14); row-major input
 * is detected by where the translation sits.
 */
export function headPoseFromMatrix(data: ArrayLike<number>): HeadPose | null {
  if (!data || data.length < 16) return null;
  const columnMajor = Math.abs(data[14]) >= Math.abs(data[11]);
  // r(row, col)
  const r = (row: number, col: number) => (columnMajor ? data[col * 4 + row] : data[row * 4 + col]);
  const r00 = r(0, 0);
  const r10 = r(1, 0);
  const r20 = r(2, 0);
  const r21 = r(2, 1);
  const r22 = r(2, 2);
  // Normalize away any uniform scale in the transform.
  const sx = Math.hypot(r00, r10, r20) || 1;
  const pitch = Math.atan2(r21, r22) * RAD;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r20 / sx))) * RAD;
  const roll = Math.atan2(r10, r00) * RAD;
  if (![pitch, yaw, roll].every(Number.isFinite)) return null;
  return { yaw, pitch, roll };
}

interface Point {
  x: number;
  y: number;
}

/** Rough head pose from landmarks (used only if the matrix is unavailable). */
export function headPoseFromLandmarks(
  nose: Point,
  cheekRight: Point,
  cheekLeft: Point,
  forehead: Point,
  chin: Point,
): HeadPose {
  const faceWidth = Math.hypot(cheekLeft.x - cheekRight.x, cheekLeft.y - cheekRight.y) || 1;
  const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) || 1;
  const midX = (cheekLeft.x + cheekRight.x) / 2;
  const midY = (forehead.y + chin.y) / 2;
  const yaw = ((nose.x - midX) / faceWidth) * 110;
  const pitch = ((nose.y - midY) / faceHeight) * 110;
  const roll = Math.atan2(cheekLeft.y - cheekRight.y, cheekLeft.x - cheekRight.x) * RAD;
  return { yaw, pitch, roll };
}
