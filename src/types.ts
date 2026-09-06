/** A video the user has chosen for processing (Phase 1: ingest only). */
export interface VideoSource {
  /** Original file handle — never uploaded, referenced by FFmpeg later. */
  file: File
  /** Object URL used for the <video> preview. */
  url: string
  name: string
  sizeBytes: number
  /** MIME type, e.g. "video/mp4" (may be empty for e.g. .mkv files). */
  type: string
  durationSec: number | null
  width: number | null
  height: number | null
  /** True when the browser codec can't decode the file for preview. */
  previewFailed: boolean
}
