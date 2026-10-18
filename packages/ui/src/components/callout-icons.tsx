import type { ComponentType } from 'react'

import { Glyph } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/*
 * The six callout kinds' marks, shared by every surface that names a kind: the
 * reader draws them as CSS masks (`@quill/design-css/prose.css`, the
 * `--callout-icon` data URIs) and the editor's slash menu, type switcher and
 * context menu draw them as these React icons. The shapes are written once
 * here as data and `callout-icons.test.tsx` holds the CSS to exactly the same
 * elements, so a reader and an author never see two different marks for one
 * kind.
 */

export type CalloutKind = 'note' | 'info' | 'tip' | 'important' | 'warning' | 'caution'

export type CalloutIconShape =
  | { readonly tag: 'path'; readonly d: string }
  | { readonly tag: 'circle'; readonly cx: string; readonly cy: string; readonly r: string }

const path = (d: string): CalloutIconShape => ({ tag: 'path', d })

export const CALLOUT_ICON_SHAPES: Readonly<Record<CalloutKind, readonly CalloutIconShape[]>> = {
  /** A page with lines on it. */
  note: [path('M3.75 1.75h5.5l3 3v9.5h-8.5z'), path('M6 8.25h4M6 11h4')],
  /** A circled i. */
  info: [{ tag: 'circle', cx: '8', cy: '8', r: '6.25' }, path('M8 7.25v4M8 4.75v.01')],
  /** A lightbulb. */
  tip: [
    path(
      'M6.25 12.25h3.5M6.75 14.25h2.5M8 1.75a4.25 4.25 0 0 0-2.4 7.76c.38.27.65.7.65 1.17v.32h3.5v-.32c0-.47.27-.9.65-1.17A4.25 4.25 0 0 0 8 1.75z',
    ),
  ],
  /** A speech bubble holding an exclamation mark. */
  important: [path('M2.25 2.75h11.5v8h-6l-3.25 2.75v-2.75h-2.25z'), path('M8 5v2.75M8 9.5v.01')],
  /** A warning triangle. */
  warning: [path('M8 1.75 1.5 13.75h13z'), path('M8 6.25v3.5M8 11.75v.01')],
  /** A stop octagon. */
  caution: [
    path('M5.5 1.75h5l3.75 3.75v5l-3.75 3.75h-5L1.75 10.5v-5z'),
    path('M8 4.75v3.75M8 10.75v.01'),
  ],
}

function calloutIcon(kind: CalloutKind): ComponentType<IconProps> {
  function KindIcon({ className }: IconProps) {
    return (
      <Glyph className={className}>
        {CALLOUT_ICON_SHAPES[kind].map((shape) =>
          shape.tag === 'circle' ? (
            <circle
              key={`${shape.cx},${shape.cy},${shape.r}`}
              cx={shape.cx}
              cy={shape.cy}
              r={shape.r}
            />
          ) : (
            <path key={shape.d} d={shape.d} />
          ),
        )}
      </Glyph>
    )
  }
  KindIcon.displayName = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}CalloutIcon`
  return KindIcon
}

export const NoteCalloutIcon = calloutIcon('note')
export const InfoCalloutIcon = calloutIcon('info')
export const TipCalloutIcon = calloutIcon('tip')
export const ImportantCalloutIcon = calloutIcon('important')
export const WarningCalloutIcon = calloutIcon('warning')
export const CautionCalloutIcon = calloutIcon('caution')

/** Each kind's own mark, so six callouts are told apart at a glance and not by their labels alone. */
export const CALLOUT_ICONS: Readonly<Record<CalloutKind, ComponentType<IconProps>>> = {
  note: NoteCalloutIcon,
  info: InfoCalloutIcon,
  tip: TipCalloutIcon,
  important: ImportantCalloutIcon,
  warning: WarningCalloutIcon,
  caution: CautionCalloutIcon,
}
