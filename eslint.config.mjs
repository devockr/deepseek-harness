// The shared config knows the state directory (.dsh) and skips it; the local helpers are not
// covered by that, and linting them reports findings in scripts that never ship.
import config from '@1stg/eslint-config'

export default [{ ignores: ['packages/*/lib/**', '.tasks/**'] }, ...config]
