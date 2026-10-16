/**
 * A number that says whether it is a total or a floor.
 *
 * A count taken over rows that were cut short is a MINIMUM, and printing it
 * bare is how "1,000" sits beside 1,500 stored records without anyone being told.
 * Exact counts render exactly as before; a floor renders with a trailing "+" and
 * a spoken "or more", so a screen reader does not read it as an exact figure.
 */
export function Count({ value, exact = true }: { value: number; exact?: boolean }) {
  const text = value.toLocaleString('en-US')
  if (exact) return <>{text}</>
  return (
    <span title={`At least ${text}: not every record could be loaded`}>
      {text}+<span className="visually-hidden"> or more</span>
    </span>
  )
}
