# viewer-workflows

Reusable GitHub Actions workflows for the MWNF Website Platform. Reference them as `metanull/viewer-workflows/.github/workflows/<file>@v1`.

| Workflow | For | Purpose | Inputs | Repo prerequisites |
|---|---|---|---|---|
| `website-ci.yml` | website repos | PR checks: build + test (blocking), ESLint + npm audit (reported only) | — | npm scripts `build`, `test`, `lint` |
| `website-deploy-pages.yml` | website repos | Build with `BASE_PATH` and deploy `dist/` to GitHub Pages | `base_path` (optional, default `/<repo-name>/`) | Pages source set to "GitHub Actions" |
| `locale-validate.yml` | website repos | Validate `locales/*.json` against `en.json` (JSON validity, key parity, placeholder integrity, no HTML); auto-merge locale-only PRs when green; plain-language PR comment on failure | — (output: `locales_only`) | "Allow auto-merge" enabled |
| `dependabot-automerge.yml` | all repos | Auto-merge Dependabot minor/patch bumps of `@metanull/viewer-core` / `@metanull/viewer-layout` and dev-dependency patches; majors wait for a human | — | "Allow auto-merge" enabled |
| `audit-scheduled.yml` | all repos | Scheduled `npm audit`; opens or updates the issue "npm audit findings" | — | — |
| `package-ci.yml` | package repos | PR checks: unit tests, `npm pack`, downstream build matrix over `dependents.json` using the PR's tarball | — | `dependents.json` at repo root (JSON array of `owner/repo`) |
| `package-release.yml` | package repos | `npm publish` to GitHub Packages, version taken from the release tag | — | `publishConfig.registry` set to `https://npm.pkg.github.com` |

## Private package access

No workflow takes a secret, and no PAT is ever stored (since v1.1.2; the
`PACKAGES_READ_TOKEN` secret of earlier releases is gone). All installs
authenticate with the run's own `github.token`:

- **CI**: for every **private** `@metanull` package a repository consumes, open
  the package's settings → **Manage Actions access** and add that repository
  with **Read** — this is what lets `github.token` install it. The grant is
  UI-only (no REST endpoint) and takes effect for runs *started after* it: a
  run that failed with `403 permission_denied: read_package` must be re-run.
  A package repo listed in `dependents.json` builds its dependents, so it needs
  read access to every private package those dependents consume, too.
- **Local development**: developers authenticate themselves — `npm login
  --registry=https://npm.pkg.github.com` or a personal `~/.npmrc` with
  `//npm.pkg.github.com/:_authToken=<their own PAT>`. Tokens never go in the
  repo or in repository secrets.

## Caller snippets

### `.github/workflows/ci.yml` (website repos)

```yaml
name: CI
on:
  pull_request:
permissions:
  contents: write
  pull-requests: write
  packages: read
jobs:
  ci:
    uses: metanull/viewer-workflows/.github/workflows/website-ci.yml@v1
  locales:
    uses: metanull/viewer-workflows/.github/workflows/locale-validate.yml@v1
```

### `.github/workflows/deploy.yml` (website repos)

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: read
  pages: write
  id-token: write
jobs:
  deploy:
    uses: metanull/viewer-workflows/.github/workflows/website-deploy-pages.yml@v1
```

### `.github/workflows/automerge.yml` (all repos)

```yaml
name: Dependabot auto-merge
on:
  pull_request:
permissions:
  contents: write
  pull-requests: write
jobs:
  automerge:
    uses: metanull/viewer-workflows/.github/workflows/dependabot-automerge.yml@v1
```

### `.github/workflows/audit.yml` (all repos)

```yaml
name: Scheduled audit
on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:
permissions:
  contents: read
  issues: write
  packages: read
jobs:
  audit:
    uses: metanull/viewer-workflows/.github/workflows/audit-scheduled.yml@v1
```

### `.github/workflows/ci.yml` (package repos)

```yaml
name: CI
on:
  pull_request:
# packages: read is required — a called workflow can only downgrade the
# caller's token, so the reusable workflow cannot add it by itself.
permissions:
  contents: read
  packages: read
jobs:
  ci:
    uses: metanull/viewer-workflows/.github/workflows/package-ci.yml@v1
```

### `.github/workflows/release.yml` (package repos)

```yaml
name: Release
on:
  release:
    types: [published]
permissions:
  contents: read
  packages: write
jobs:
  release:
    uses: metanull/viewer-workflows/.github/workflows/package-release.yml@v1
```

## Versioning

- Tags: immutable `vX.Y.Z` releases plus a moving `v1` tag pointing at the latest `v1.x.y`.
- After releasing `vX.Y.Z` on the 1.x line: `git tag -f v1 vX.Y.Z && git push origin v1 --force`.
