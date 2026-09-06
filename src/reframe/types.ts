/** One detected face center (normalized 0..1 within the source frame). */
export interface FaceSample {
  /** Clip-relative time (seconds from clip start). */
  t: number
  /** Center X of the dominant face, or null when no face was found. */
  cx: number | null
  /** Center Y of the dominant face, or null when no face was found. */
  cy: number | null
  /** How many faces MediaPipe saw in this frame. */
  faceCount: number
}

/** A smoothed crop-path keyframe (one per second of the clip). */
export interface CropKeyframe {
  /** Clip-relative time in seconds. */
  t: number
  /** Crop-box center X as a fraction of source width (0..1). */
  cx: number
  /** Crop-box center Y as a fraction of source height (0..1). */
  cy: number
  /** Center was derived from a real face (vs. fallback to frame center). */
  fromFace: boolean
}

/** Result of Phase 4 for one selected clip. */
export interface ReframeResult {
  /** Source video dimensions the crop is expressed in. */
  sourceWidth: number
  sourceHeight: number
  /** Crop-box size in source pixels (targets 9:16, both values even). */
  cropWidth: number
  cropHeight: number
  /** Smooth path, one keyframe per second of clip time. */
  keyframes: CropKeyframe[]
  /** Frames MediaPipe ran on / frames with ≥1 face. */
  totalFrames: number
  facesDetected: number
  /** How the track was derived. */
  mode: 'face-tracked' | 'fallback-center'
}

export type ReframePhase =
  | 'idle'
  | 'preparing' // downloading MediaPipe runtime + model (first run)
  | 'tracking' // sampling frames + detecting faces
  | 'computing' // smoothing + crop-path math
  | 'done'
  | 'error'

export interface ReframeState {
  phase: ReframePhase
  error: string | null
  /** Clip-relative progress detail during `tracking`. */
  progress: { done: number; total: number; label: string } | null
  startedAt: number | null
}
