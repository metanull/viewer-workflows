# Maintaining the MWNF website platform

One flow, followed unconditionally. Everything below either serves it or is a
rule that keeps it honest.

## Three rules

**1. A credential is never named in a tracked file.**
CI authenticates to GitHub Packages through `actions/setup-node`
(`registry-url` + `scope`) with `NODE_AUTH_TOKEN: ${{ github.token }}`.
Developers authenticate from their own `~/.npmrc`. The propagation tool uses
the operator's own `gh` login. No PAT is stored in any repository, secret or
`.env`, and nothing in the platform needs one.

A committed `.npmrc` maps the scope to the registry and stops there:

```
@metanull:registry=https://npm.pkg.github.com
```

It must never carry a `_authToken` line — a project `.npmrc` overrides the
developer's own, so an auth line there *blocks* a correctly logged-in machine,
and npm prints the token in the resulting error.

**2. Published packages are `1.x` or higher.**
Under `0.x`, `^0.2.0` admits only `0.2.y`, so a "minor" release falls outside
the declared range: `npm update` silently changes nothing and "minor is
additive" is not true. From `1.0.0` the ranges mean what everyone assumes.
Sites declare `^1.0.0` — never `*`, which is not a constraint at all and leaves
the manifest carrying no intent.

**3. Dependabot does not manage the `@metanull` scope, and never will.**
GitHub Packages requires a token for every install — including of a *public*
package; `viewer-core` and `viewer-layout` are public and still fail — and
Dependabot has no route to one short of a PAT in every repository. Each site's
`.github/dependabot.yml` therefore ignores the scope, and those packages are
propagated by the operator instead.

This is not a workaround for something that will be fixed later. It is the
consequence of publishing to GitHub Packages, accepted deliberately in exchange
for keeping the estate on GitHub with no organisation and no second registry.

Dependabot still runs, and matters: it keeps **third-party** dependencies and
**GitHub Actions** current, both of which resolve fine.

## The flow

Identical for `viewer-core`, `viewer-layout`, `viewer-i18n` and every
`<dataset>-data` package. There is no second procedure.

| | Step | Gate |
|---|---|---|
| 1 | Open a PR on the package repository | Its CI builds **every** website against the packed tarball. This is the only cross-site check that exists — nothing downstream repeats it. |
| 2 | Merge, tag `vX.Y.Z`, publish the GitHub Release | `package-release.yml` publishes to GitHub Packages. Publishing the *Release* is the trigger; merging is not. |
| 3 | **Propagate** | The one human decision: *when*. |
| 4 | One PR per website, each running that site's own CI | Green merges itself. Red stops and waits for a person. |
| 5 | Merge deploys the site | |

Step 4 merging on green is safe *because* step 1 already built that exact
tarball against every site: a green site PR carries no new information. The
operator controls **when** propagation happens; CI controls **whether** it
lands.

### Step 3, with the tool

```bash
docker run --rm -it \
  -v "$PWD:/w" -v "$HOME/.npmrc:/root/.npmrc:ro" -v "$HOME/.config/gh:/root/.config/gh:ro" \
  -w /w node:lts-alpine sh -c "apk add --no-cache github-cli >/dev/null && \
    node tools/propagate.mjs --expect viewer-core@1.0.0 --expect viewer-layout@1.0.0"
```

Add `--dry-run` first if you want to see what it would do. `--repo owner/name`
restricts it to one site; `--no-merge` opens the pull requests without enabling
auto-merge.

`--expect` is required on purpose. Run before the publish workflow has
finished and `latest` still resolves to the previous version: the tool would
bump nothing and exit 0, which looks exactly like success. `--expect` turns
that silent no-op into a refusal.

### Step 3, by hand

The tool only removes repetition; the procedure stands without it. Per site:

```bash
gh repo clone metanull/<site> && cd <site>
git checkout -b chore/propagate-platform-packages
npm install @metanull/viewer-core@latest @metanull/viewer-layout@latest
git commit -am "chore(deps): adopt the published @metanull packages"
gh pr create --fill && gh pr merge --auto --squash
```

Use `npm install …@latest`, not `npm update`: update only moves within the
declared range, so it does nothing when a release falls outside it.

## Which websites are consumers

Derived, never listed. A website is a repository created from
`website-template`, and GitHub records that permanently as
`template_repository`. Both `package-ci.yml`'s downstream matrix and
`tools/propagate.mjs` read it, so the set of sites validated before a release
and the set updated after it cannot drift apart.

This replaced a hand-written `dependents.json` kept in both package repos,
which had to be edited in two places for every new site and, until the
`Downstream (all)` fan-in job, also needed a matching branch-protection edit.

**Blind spot, accepted knowingly:** discovery finds repositories *owned by the
template's owner* that still carry the link. A site created by fork or
transferred in from elsewhere is invisible to both. The resolved list and its
count are printed on every CI run and every propagation, so an unexpected drop
is visible; pass such a site explicitly with `--repo`.

## Releasing viewer-workflows itself

Tags here are **immutable**. Release `vX.Y.Z` and stop; there is no moving
major tag. Consumers pin the exact version and Dependabot's `github-actions`
ecosystem — which is unaffected by rule 3, since it resolves against the GitHub
API rather than the npm registry — brings each repository a pull request that
runs its own CI before adopting the release. `v1` still exists, frozen at
v1.1.2, and nothing should newly reference it.

The reasoning is in the README's Versioning section.
