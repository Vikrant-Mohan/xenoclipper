/** Video file detection helpers shared by the drop zone and the app. */

export const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'avi',
  'ogv',
  'mpg',
  'mpeg',
  'mts',
  'ts',
  '3gp',
  'wmv',
  'flv',
])

export const ACCEPT =
  'video/*,' + [...VIDEO_EXTENSIONS].map((ext) => `.${ext}`).join(',')

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.has(ext)
}
