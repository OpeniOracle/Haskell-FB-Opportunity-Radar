/**
 * Inline icon set.
 *
 * Hand-drawn rather than pulled from an icon package: PR 1 must stay
 * dependency-light, and every status indicator in this product is required to
 * carry a DISTINCT SHAPE, not just a colour (04_UX_DESIGN_SPEC.md, accessibility).
 * A generic icon font would make the shapes interchangeable, which is exactly
 * what we do not want — "confirmed" and "attention" must be tellable apart in
 * greyscale.
 *
 * All icons are `aria-hidden`. The meaning always lives in adjacent text.
 */

export type IconName =
  | 'pulse'
  | 'target'
  | 'building'
  | 'trend'
  | 'settings'
  | 'check'
  | 'clock'
  | 'spark'
  | 'alert'
  | 'dot'
  | 'document'
  | 'chevron'
  | 'sun'
  | 'moon'
  | 'flask'
  | 'inbox'
  | 'lock'
  | 'refresh'
  | 'pin'
  | 'external'

interface IconProps {
  name: IconName
  className?: string
  /** Edge length in pixels. CSS on `className` overrides it. */
  size?: number
}

const PATHS: Record<IconName, React.ReactNode> = {
  // Navigation
  pulse: <path d="M2 12h4l3-8 4 16 3-8h4" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6l7-3v18" />
      <path d="M11 10h6a2 2 0 0 1 2 2v9" />
      <path d="M2 21h20" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l5.5-6 4 3.5L21 6" />
      <path d="M15 6h6v6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),

  // Status — deliberately distinct silhouettes
  check: <path d="M4 12.5l5.2 5.2L20 6.8" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  spark: <path d="M12 3l2.2 5.9L20 11l-5.8 2.1L12 19l-2.2-5.9L4 11l5.8-2.1z" />,
  alert: (
    <>
      <path d="M12 3.5L21.5 20H2.5z" />
      <path d="M12 10v4.2M12 17.2v.1" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4.5" />,

  // Utility
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  flask: (
    <>
      <path d="M9 3h6M10 3v6.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M7.4 14h9.2" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 4h13l2.5 9v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-.8 4.5" />
      <path d="M20 4.5V11h-6.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
}

/**
 * THE DEFAULT SIZE IS LOAD-BEARING. Do not remove it.
 *
 * An `<svg>` with a `viewBox` and no width or height is a replaced element
 * whose used width resolves to the space available. Inside a flex row that
 * means it takes the whole line, and `flex: none` -- which every icon rule here
 * sets, to stop icons being squashed -- then refuses to shrink it back. That is
 * not a hypothetical: it shipped. The login error icon measured 252x252 at a
 * 360px viewport and 344x344 at 1440px, leaving the message an 84px column, and
 * every DOM-only test passed because jsdom has no layout engine to measure.
 *
 * These are presentation attributes, so any caller that sets a size in CSS
 * still wins -- the sized call sites are unaffected. What changes is that an
 * icon with NO size is now 20px instead of unbounded.
 */
export function Icon({ name, className, size = 20 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
