// The shared config, plus the trees that are not ours to lint. eslint, unlike prettier, does not
// read .gitignore — so the state directory (a browser cache, a pristine dsh copy, skills) and the
// local helpers have to be named here or they get linted.
import config from '@1stg/eslint-config'

export default [
  { ignores: ['packages/*/lib/**', '.dsh/**', '.tasks/**', 'node_modules/**'] },
  ...config,
]
