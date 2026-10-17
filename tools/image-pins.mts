/**
 * The pins the published image installs — `dsh plugin --profile web add <pkg>@<version>` lines in
 * `Dockerfile` — matched in one place, so the tool that writes them and the check that guards the
 * release agree on what "what the image bakes" means.
 */

export interface Pin {
  name: string
  version: string
}

/** `@scope/name@version`: the only shape a pin has, and the only pattern either tool matches. */
const pin = /(@[^@\s]+)@([^\s@]+)/

/**
 * A fresh matcher per call, from the one pattern above: `matchAll` inherits `lastIndex` from the
 * regex it is handed, so a shared `/g` would start skipping matches the moment anything advanced it
 * — a `pin.test(line)` somewhere else would be enough.
 */
const pinMatcher = (): RegExp => new RegExp(pin.source, 'g')

/**
 * A line that installs plugins from the registry, which is where a pin lives. Two things disqualify
 * one: it is a comment — `#` says so, and the absence of `add` does not, since a comment can quote
 * the whole command — or it has no `add` verb, which is what makes it an install and not a mention.
 */
export const isPluginLine = (line: string): boolean =>
  !/^\s*#/.test(line) && /\bdsh\s+plugin\b[^\n]+\badd\b/.test(line)

/** The pins on one line, in the order they appear. */
export const pinsIn = (line: string): Pin[] => {
  const pins: Pin[] = []
  for (const match of line.matchAll(pinMatcher())) {
    pins.push({ name: match[1], version: match[2] })
  }
  return pins
}

/** Rewrite pins on one line; returning `undefined` from `pick` leaves that pin as it was. */
export const rewritePins = (
  line: string,
  pick: (pin: Pin) => string | undefined,
): string =>
  line.replaceAll(pinMatcher(), (whole, name: string, version: string) => {
    return pick({ name, version }) ?? whole
  })
