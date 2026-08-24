# viewer-workflows

Reusable GitHub Actions workflows for the MWNF Website Platform. Reference them as `metanull/viewer-workflows/.github/workflows/<file>@v1`.

| Workflow | For | Purpose | Inputs | Secrets | Repo prerequisites |
|---|---|---|---|---|---|
| `website-ci.yml` | website repos | PR checks: build + test (blocking), ESLint + npm audit (reported only) | — | `PACKAGES_READ_TOKEN`¹ | npm scripts `build`, `test`, `lint` |
| `website-deploy-pages.yml` | website repos | Build with `BASE_PATH` and deploy `dist/` to GitHub Pages | `base_path` (optional, default `/<repo-name>/`) | `PACKAGES_READ_TOKEN`¹ | Pages source set to "GitHub Actions" |
| `locale-validate.yml` | website repos | Validate `locales/*.json` against `en.json` (JSON validity, key parity, placeholder integrity, no HTML); auto-merge locale-only PRs when green; plain-language PR comment on failure | — (output: `locales_only`) | — | "Allow auto-merge" enabled |
| `dependabot-automerge.yml` | all repos | Auto-merge Dependabot minor/patch bumps of `@metanull/viewer-core` / `@metanull/viewer-layout` and dev-dependency patches; majors wait for a human | — | — | "Allow auto-merge" enabled |
| `audit-scheduled.yml` | all repos | Scheduled `npm audit`; opens or updates the issue "npm audit findings" | — | `PACKAGES_READ_TOKEN`¹ | — |

¹ Optional since v1.1.0: when the secret is not set, the workflow falls back to `github.token`, which can install **public** `@metanull` packages. Set the real `read:packages` PAT as soon as the repo consumes a private package (e.g. a `@metanull/<dataset>-data` published from a private repo).
| `package-ci.yml` | package repos | PR checks: unit tests, `npm pack`, downstream build matrix over `dependents.json` using the PR's tarball | — | `PACKAGES_READ_TOKEN` | `dependents.json` at repo root (JSON array of `owner/repo`) |
| `package-release.yml` | package repos | `npm publish` to GitHub Packages, version taken from the release tag | — | `PACKAGES_READ_TOKEN` | `publishConfig.registry` set to `https://npm.pkg.github.com` |

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
    secrets: inherit
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
    secrets: inherit
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
    secrets: inherit
```

### `.github/workflows/ci.yml` (package repos)

```yaml
name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  ci:
    uses: metanull/viewer-workflows/.github/workflows/package-ci.yml@v1
    secrets: inherit
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
    secrets: inherit
```

## Versioning

- Tags: immutable `vX.Y.Z` releases plus a moving `v1` tag pointing at the latest `v1.x.y`.
- After releasing `vX.Y.Z` on the 1.x line: `git tag -f v1 vX.Y.Z && git push origin v1 --force`.
