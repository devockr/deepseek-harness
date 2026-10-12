// The shared config skips the state directory and any lib/ on its own; the local helpers are not
// covered by that, and linting them reports findings in scripts that never ship.
import config from '@1stg/eslint-config'

export default [
  { ignores: ['.tasks/**'] },
  ...config,
  {
    // tools/ is not an npm package: n/no-process-exit and n/hashbang both ask whether the file
    // belongs to a published bin, which these repo scripts never do. The shebangs are there and
    // unicorn's own no-process-exit is satisfied by them.
    files: ['tools/**'],
    rules: { 'n/no-process-exit': 'off', 'n/hashbang': 'off' },
  },
]
