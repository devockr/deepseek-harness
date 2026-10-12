// The shared config skips the state directory and any lib/ on its own; the local helpers are not
// covered by that, and linting them reports findings in scripts that never ship.
import config from '@1stg/eslint-config'

export default [{ ignores: ['.tasks/**'] }, ...config]
