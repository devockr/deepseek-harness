// Deliberately one rule: every control body gets braces. The shared configs bring whole rule
// sets, and adopting those is a separate decision from fixing the braces.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['packages/*/lib/**', 'node_modules/**', '.tasks/**'] },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.mjs'],
    languageOptions: { parser: tseslint.parser },
    rules: { curly: ['error', 'all'] },
  },
)
