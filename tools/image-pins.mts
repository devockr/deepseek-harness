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
const pin = /(@[^@\s]+)@([^\s@]+)/g

/** A line that installs a plugin from the registry; a version anywhere else is not a pin. */
export const isPluginLine = (line: string): boolean =>
  /\bdsh\s+plugin\b/.test(line)

/** The pins on one line, in the order they appear. */
export const pinsIn = (line: string): Pin[] => {
  const pins: Pin[] = []
  for (const match of line.matchAll(pin)) {
    pins.push({ name: match[1], version: match[2] })
  }
  return pins
}

/** Rewrite pins on one line; returning `undefined` from `pick` leaves that pin as it was. */
export const rewritePins = (
  line: string,
  pick: (pin: Pin) => string | undefined,
): string =>
  line.replaceAll(pin, (whole, name: string, version: string) => {
    return pick({ name, version }) ?? whole
  })
