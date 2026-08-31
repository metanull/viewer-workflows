# viewer-workflows

Reusable GitHub Actions workflows for the MWNF Website Platform. Reference them by an exact version — `metanull/viewer-workflows/.github/workflows/<file>@v1.4.0`. Tags here are immutable; see [Versioning](#versioning). Platform maintenance procedure: [MAINTENANCE.md](MAINTENANCE.md).

| Workflow | For | Purpose | Inputs | Repo prerequisites |
|---|---|---|---|---|
| `website-ci.yml` | website repos | PR checks: build + test (blocking), ESLint + npm audit (reported only) | — | npm scripts `build`, `test`, `lint` |
| `website-deploy-pages.yml` | website repos | Build with `BASE_PATH` and deploy `dist/` to GitHub Pages | `base_path` (optional, default `/<repo-name>/`) | Pages source set to "GitHub Actions" |
| `locale-validate.yml` | website repos | Validate `locales/*.json` against `en.json` (JSON validity, key parity, placeholder integrity, no HTML); auto-merge locale-only PRs when green; plain-language PR comment on failure | — (output: `locales_only`) | "Allow auto-merge" enabled |
| `dependabot-automerge.yml` | all repos | Auto-merge Dependabot minor/patch bumps of the reusable workflows and dev-dependency patches; majors wait for a human. The `@metanull` npm scope is not covered — Dependabot cannot read it; see [MAINTENANCE.md](MAINTENANCE.md) | — | "Allow auto-merge" enabled |
| `audit-scheduled.yml` | all repos | Scheduled `npm audit`; opens or updates the issue "npm audit findings" | — | — |
| `package-ci.yml` | package repos | PR checks: unit tests, `npm pack`, downstream build matrix over every website, using the PR's tarball | — | — (websites are discovered from the `website-template` link) |
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
  A package repo builds every website downstream, so it needs read access to
  every private package those websites consume, too.
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
    uses: metanull/viewer-workflows/.github/workflows/website-ci.yml@v1.4.0
  locales:
    uses: metanull/viewer-workflows/.github/workflows/locale-validate.yml@v1.4.0
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
    uses: metanull/viewer-workflows/.github/workflows/website-deploy-pages.yml@v1.4.0
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
    uses: metanull/viewer-workflows/.github/workflows/dependabot-automerge.yml@v1.4.0
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
    uses: metanull/viewer-workflows/.github/workflows/audit-scheduled.yml@v1.4.0
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
    uses: metanull/viewer-workflows/.github/workflows/package-ci.yml@v1.4.0
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
    uses: metanull/viewer-workflows/.github/workflows/package-release.yml@v1.4.0
```

## Versioning

**Tags are immutable. Nothing is ever force-moved.**

- Release `vX.Y.Z` and stop. There is no moving major tag to update.
- Consumers pin the exact version:
  `uses: metanull/viewer-workflows/.github/workflows/website-ci.yml@v1.4.0`
- Every consumer declares the `github-actions` Dependabot ecosystem, so a new
  release arrives there as a pull request. Dependabot covers
  [reusable-workflow refs](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot),
  not just step-level actions.

To release: tag `vX.Y.Z` on `main`, push the tag, done. Dependabot does the rest
on its weekly run; to propagate immediately, use **Insights → Dependency graph →
Dependabot → Check for updates** on the consumers.

### Why not a moving `v1`

A floating major tag is GitHub's normal convention for actions, and this repo
used one until v1.2.0. It fits this platform badly:

- **It ships unverified CI to every repo at once.** `package-ci.yml` builds
  every website against a packed tarball before a *package*
  change can merge — but a *workflow* change had no equivalent check, and a
  broken workflow breaks all ten repos rather than one package's consumers.
  Pinning exactly means each repo runs its own CI, including the full
  `Downstream` matrix, before it adopts a release.
- **A force-moved tag has no audit trail.** Nothing records what `v1` pointed at
  last week or when a given repo started using it. With exact pins, `git log`
  answers both, and a rollback is reverting one pull request in one repo instead
  of another force-push under pressure.

The cost is one pull request per consumer per release instead of none.
`dependabot-automerge.yml` absorbs that: minor and patch bumps merge themselves
once CI is green, and majors wait for a human.

`v1` still exists, frozen at v1.1.2. It is deliberately not deleted — anything
still pointing at it keeps working — but nothing should newly reference it.
