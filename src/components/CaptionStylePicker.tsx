import type { ReactNode } from 'react'
import {
  CAPTION_FONTS,
  CAPTION_THEMES,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_MODES,
  POSITION_OPTIONS,
  SIZE_OPTIONS,
  themeFor,
  type CaptionStyle,
} from '../render/caption'

interface CaptionStylePickerProps {
  style: CaptionStyle
  onChange: (style: CaptionStyle) => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
    </div>
  )
}

const segActive =
  'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
const segIdle =
  'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200'

/**
 * Controls for the karaoke caption look — font, color theme, highlight mode,
 * font size and on-screen position. The live preview sits next to these; the
 * choice is carried into the render unchanged.
 */
export function CaptionStylePicker({ style, onChange }: CaptionStylePickerProps) {
  const theme = themeFor(style)
  return (
    <div className="space-y-2.5">
      <Row label="Font">
        {CAPTION_FONTS.map((f) => {
          const active = style.font === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange({ ...style, font: f.id })}
              aria-pressed={active}
              title={f.name}
              className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                active ? segActive : segIdle
              }`}
              style={{
                fontFamily: f.cssFamily,
                fontWeight: f.bold ? 700 : 400,
                letterSpacing: '0.02em',
              }}
            >
              {f.name}
            </button>
          )
        })}
      </Row>

      <Row label="Style">
        {HIGHLIGHT_MODES.map((m) => {
          const active = style.highlight === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...style, highlight: m.id })}
              aria-pressed={active}
              title={m.description}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                active ? segActive : segIdle
              }`}
            >
              <span
                className="size-3.5 rounded-full ring-1 ring-black/40"
                style={{ backgroundColor: m.id === 'fill' ? theme.fill : style.highlightColor }}
              />
              {m.label}
            </button>
          )
        })}
      </Row>

      {style.highlight === 'spotlight' && (
        <Row label="Color">
          {HIGHLIGHT_COLORS.map((c) => {
            const active = style.highlightColor === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...style, highlightColor: c })}
                aria-pressed={active}
                title={c}
                className={`relative flex size-6 items-center justify-center rounded-full transition-transform ${
                  active ? 'scale-110 ring-2 ring-white/80' : 'ring-1 ring-white/30 hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              >
                {active && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            )
          })}
        </Row>
      )}

      <Row label="Theme">
        {CAPTION_THEMES.map((t) => {
          const active = style.theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ ...style, theme: t.id })}
              aria-pressed={active}
              title={t.name}
              className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors ${
                active ? segActive : segIdle
              }`}
            >
              <span className="flex -space-x-1">
                <span
                  className="size-3.5 rounded-full ring-1 ring-black/40"
                  style={{ backgroundColor: t.base }}
                />
                <span
                  className="size-3.5 rounded-full ring-1 ring-black/40"
                  style={{ backgroundColor: t.fill }}
                />
              </span>
              <span className="text-[11px] font-medium">{t.name}</span>
            </button>
          )
        })}
      </Row>

      <Row label="Size">
        {SIZE_OPTIONS.map((s) => {
          const active = style.size === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange({ ...style, size: s.id })}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-1 text-[11px] font-medium transition-colors ${
                active ? segActive : segIdle
              }`}
            >
              {s.label}
            </button>
          )
        })}
      </Row>

      <Row label="Position">
        {POSITION_OPTIONS.map((p) => {
          const active = style.position === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ ...style, position: p.id })}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? segActive : segIdle
              }`}
            >              <span className="flex h-3 w-4 rounded-[3px] border border-zinc-500/40 p-[2px]">
                <span
                  className={`block h-[2px] w-full rounded-full ${active ? 'bg-indigo-300' : 'bg-zinc-500'}`}
                  style={
                    p.id === 'center'
                      ? { marginTop: 'auto', marginBottom: 'auto' }
                      : p.id === 'top'
                        ? { marginBottom: 'auto' }
                        : { marginTop: 'auto' }
                  }
                />
              </span>
              {p.label}
            </button>
          )
        })}
      </Row>
    </div>
  )
}
