/**
 * Host half. It exists so the package composes as a row; the decision it carries is
 * made in the browser (see ./client), because that is where dsh decides whether the
 * privileged surface belongs to the page.
 */
export const name = '@idsh/privileged-ui'

/** Nothing to do on the host: no service, no config, no state. */
export function apply() {}
