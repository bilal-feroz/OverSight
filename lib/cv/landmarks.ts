/**
 * MediaPipe Face Landmarker (478-point mesh with refined iris) indices.
 *
 * "Right"/"left" are the subject's own sides. In an un-mirrored camera
 * image the subject's right eye appears on the image-left.
 */
export const LM = {
  /** Subject's right eye: image-left corner (outer) and image-right corner (inner). */
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeUpper: 159,
  rightEyeLower: 145,
  /** Subject's left eye: image-left corner (inner) and image-right corner (outer). */
  leftEyeInner: 362,
  leftEyeOuter: 263,
  leftEyeUpper: 386,
  leftEyeLower: 374,
  /** Iris centres and contours (refined landmarks 468-477). */
  irisA: [468, 469, 470, 471, 472],
  irisB: [473, 474, 475, 476, 477],
  noseTip: 1,
  forehead: 10,
  chin: 152,
  cheekRight: 234,
  cheekLeft: 454,
} as const;

export const LANDMARK_COUNT_WITH_IRIS = 478;

/**
 * Only these blendshape coefficients are ever read: eye direction and blink.
 * Every other coefficient MediaPipe produces (mouth, brows, cheeks...) is
 * ignored and never stored. OverSight does not analyze facial expressions.
 */
export const EYE_BLENDSHAPES = [
  "eyeLookInLeft",
  "eyeLookOutLeft",
  "eyeLookUpLeft",
  "eyeLookDownLeft",
  "eyeLookInRight",
  "eyeLookOutRight",
  "eyeLookUpRight",
  "eyeLookDownRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
] as const;

export type EyeBlendshapeName = (typeof EYE_BLENDSHAPES)[number];
