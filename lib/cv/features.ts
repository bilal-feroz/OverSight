/**
 * Landmarks -> gaze features. Pure function; runs on-device per frame.
 *
 * Iris position is measured inside each eye's own coordinate frame (along
 * and perpendicular to the corner-to-corner axis), which makes it robust to
 * head roll and to where the face sits in the camera image.
 */
import type { EyeFeatures } from "@/types/cv";
import { CV_CONFIG } from "./config";
import { headPoseFromLandmarks, headPoseFromMatrix } from "./head-pose";
import { LANDMARK_COUNT_WITH_IRIS, LM } from "./landmarks";

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

interface P {
  x: number;
  y: number;
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function centroid(points: P[]): P {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Returns [imageLeft, imageRight]. */
function orderByX(a: P, b: P): [P, P] {
  return a.x <= b.x ? [a, b] : [b, a];
}

export interface EyeGeometry {
  /** 0 at the image-left corner, 1 at the image-right corner. */
  h: number;
  /** Perpendicular offset / eye width (+ = below the axis). */
  v: number;
  openness: number;
  width: number;
  center: P;
}

export function eyeGeometry(leftCorner: P, rightCorner: P, upper: P, lower: P, iris: P): EyeGeometry {
  const ux = rightCorner.x - leftCorner.x;
  const uy = rightCorner.y - leftCorner.y;
  const w = Math.hypot(ux, uy) || 1e-6;
  const ex = ux / w;
  const ey = uy / w;
  // Perpendicular pointing "down" in image coordinates (y grows downward).
  const nx = -ey;
  const ny = ex;
  const center = mid(leftCorner, rightCorner);
  const h = ((iris.x - leftCorner.x) * ex + (iris.y - leftCorner.y) * ey) / w;
  const v = ((iris.x - center.x) * nx + (iris.y - center.y) * ny) / w;
  const openness = dist(upper, lower) / w;
  return { h, v, openness, width: w, center };
}

/**
 * @param landmarks 478 normalized landmarks (x,y in 0..1 of image width/height)
 * @param blendshapes MediaPipe blendshape categories; only eye-direction and blink entries are read
 * @param matrix facial transformation matrix (flattened 4x4), if available
 * @param aspect video width / height, to make distances isotropic
 */
export function extractEyeFeatures(
  landmarks: readonly LandmarkPoint[],
  blendshapes: readonly BlendshapeCategory[] | null,
  matrix: ArrayLike<number> | null,
  aspect: number,
): EyeFeatures | null {
  if (landmarks.length < LANDMARK_COUNT_WITH_IRIS) return null;
  const at = (i: number): P => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });

  const rightEye = orderByX(at(LM.rightEyeOuter), at(LM.rightEyeInner));
  const leftEye = orderByX(at(LM.leftEyeInner), at(LM.leftEyeOuter));
  const rightCenter = mid(rightEye[0], rightEye[1]);
  const leftCenter = mid(leftEye[0], leftEye[1]);

  const irisA = centroid(LM.irisA.map(at));
  const irisB = centroid(LM.irisB.map(at));
  // Assign irises to eyes by proximity rather than trusting index order.
  const aIsRight =
    dist(irisA, rightCenter) + dist(irisB, leftCenter) <= dist(irisA, leftCenter) + dist(irisB, rightCenter);
  const irisRight = aIsRight ? irisA : irisB;
  const irisLeft = aIsRight ? irisB : irisA;

  const gR = eyeGeometry(rightEye[0], rightEye[1], at(LM.rightEyeUpper), at(LM.rightEyeLower), irisRight);
  const gL = eyeGeometry(leftEye[0], leftEye[1], at(LM.leftEyeUpper), at(LM.leftEyeLower), irisLeft);

  const bs = (name: string) => blendshapes?.find((c) => c.categoryName === name)?.score ?? 0;
  const bsH =
    (bs("eyeLookOutLeft") - bs("eyeLookInLeft") + (bs("eyeLookInRight") - bs("eyeLookOutRight"))) / 2;
  const bsV =
    (bs("eyeLookUpLeft") + bs("eyeLookUpRight") - (bs("eyeLookDownLeft") + bs("eyeLookDownRight"))) / 2;
  const openness = (gR.openness + gL.openness) / 2;
  // Both eyes must close: looking down lowers the lids and raises blink scores a little.
  const blink = blendshapes
    ? Math.min(bs("eyeBlinkLeft"), bs("eyeBlinkRight")) > CV_CONFIG.gaze.blinkThreshold
    : openness < 0.12;

  const pose =
    (matrix ? headPoseFromMatrix(matrix) : null) ??
    headPoseFromLandmarks(
      at(LM.noseTip),
      at(LM.cheekRight),
      at(LM.cheekLeft),
      at(LM.forehead),
      at(LM.chin),
    );

  const faceCenter = mid(rightCenter, leftCenter);
  return {
    irisH: (gR.h + gL.h) / 2,
    irisV: (gR.v + gL.v) / 2,
    openness,
    bsH,
    bsV,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    faceX: faceCenter.x / aspect,
    faceY: faceCenter.y,
    faceScale: dist(rightCenter, leftCenter) / aspect,
    blink,
  };
}
