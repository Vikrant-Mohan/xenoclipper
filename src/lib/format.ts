/** Human-readable formatting helpers. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  const text = i === 0 || value >= 100 ? `${Math.round(value)}` : value.toFixed(1)
  return `${text} ${units[i]}`
}

export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function aspectLabel(w: number | null, h: number | null): string {
  if (!w || !h || w <= 0 || h <= 0) return '—'
  const g = gcd(w, h)
  if (g === 0) return '—'
  return `${w / g}:${h / g}`
}
