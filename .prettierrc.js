// The shared config, plus one override: prettier-plugin-sh matches the exact filename
// `Dockerfile`, so the dev variant is told which parser to use.
import shared from '@1stg/prettier-config'

export default {
  ...shared,
  overrides: [
    ...(shared.overrides ?? []),
    { files: 'Dockerfile.dev', options: { parser: 'dockerfile' } },
  ],
}
