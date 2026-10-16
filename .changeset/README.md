# Changesets

One markdown file per pull request, naming each package it changed and the bump that change needs.
`pnpm changeset` writes it interactively; the release workflow reads every file in this directory and
folds them into a single "Version Packages" pull request, whose merge is what publishes.

- **A change to a package under `packages/` needs one.** It is the only place a version and a
  changelog entry can come from — the `version` field in a package's `package.json` is an output of
  this flow, not something to edit.
- **A change that ships nothing does not.** Docs, CI and the images are not versioned by changesets.
- `pnpm changeset` — describe the change, pick `patch` / `minor` / `major` per package.
- `pnpm version` — apply the files: bump versions, write each `CHANGELOG.md`, refresh the lockfile.
  The release workflow runs it on the version pull request; there is no reason to run it by hand.
- `pnpm release` — `changeset publish`, which runs each package's `prepack` build and uploads it.
  The release workflow runs it; anything local needs npm authentication.

The front matter is the only part that matters; the file name is random, and the changelog text
under it is what a reader sees.
