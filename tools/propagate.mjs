#!/usr/bin/env node
/**
 * Propagate published @metanull packages to every MWNF website.
 *
 * This is step 3 of the release flow in MAINTENANCE.md, and the one step a
 * human triggers. Everything before it is CI; everything after it is CI.
 *
 * Why this exists rather than Dependabot: GitHub Packages requires a token for
 * every npm install — including of a PUBLIC package — and Dependabot has no
 * route to one that does not mean storing a PAT in every repository. So the
 * @metanull scope is ignored in each site's dependabot.yml and propagated
 * here instead, using the operator's own credentials, which are already on
 * their machine and are never written anywhere.
 *
 * Usage:
 *   node tools/propagate.mjs --expect viewer-core@1.0.0 [--expect viewer-layout@1.0.0]
 *   node tools/propagate.mjs --expect carpets-data@1.1.0 --repo metanull/carpets
 *   node tools/propagate.mjs --expect viewer-core@1.0.0 --dry-run
 *
 * Options:
 *   --expect <name>@<version>  REQUIRED, repeatable. Refuses to run until the
 *                              registry actually serves this version. Without
 *                              it a run started before the publish workflow
 *                              finished would resolve `latest` to the previous
 *                              version, bump nothing, and exit 0 — a silent
 *                              no-op that looks like success.
 *   --repo <owner/name>        Restrict to one site. Repeatable. Also the
 *                              escape hatch for a site the discovery below
 *                              cannot see.
 *   --dry-run                  Resolve and report; touch nothing.
 *   --no-merge                 Open the pull requests but do not enable
 *                              auto-merge.
 *
 * Requires: `gh` authenticated as the operator, and a personal
 * ~/.npmrc carrying a GitHub Packages token. Never reads a token from the
 * environment and never prints one.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCOPE = '@metanull'
const TEMPLATE_REPO = 'website-template'
const BRANCH = 'chore/propagate-platform-packages'

// ── Arguments ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const expect = []
  const repos = []
  let dryRun = false
  let merge = true
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--expect') expect.push(argv[++i])
    else if (arg === '--repo') repos.push(argv[++i])
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--no-merge') merge = false
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!expect.length) {
    throw new Error(
      '--expect <package>@<version> is required.\n' +
      'It is what stops a run started before the publish workflow finished from ' +
      'silently propagating nothing.'
    )
  }
  return { expect, repos, dryRun, merge }
}

// ── Shell helpers ──────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()
}

function gh(args, opts = {}) {
  return run('gh', args, opts)
}

// ── Preconditions ──────────────────────────────────────────────────────────

/**
 * Refuse to start unless the registry already serves every expected version.
 *
 * `npm view` authenticates from the operator's own ~/.npmrc. A failure here is
 * almost always one of two things, and the message says which: the publish
 * workflow has not finished, or the machine is not logged in to GitHub
 * Packages.
 */
function verifyPublished(expect) {
  for (const spec of expect) {
    const at = spec.lastIndexOf('@')
    if (at <= 0) throw new Error(`--expect must be <package>@<version>, got "${spec}"`)
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    const full = name.startsWith('@') ? name : `${SCOPE}/${name}`
    let published
    try {
      published = run('npm', ['view', `${full}@${version}`, 'version'])
    } catch {
      throw new Error(
        `${full}@${version} is not on the registry.\n` +
        '  · If you have just merged the release PR, the publish workflow may still be running —\n' +
        '    it is triggered by publishing the GitHub Release, not by the merge.\n' +
        '  · Otherwise check that this machine is logged in to GitHub Packages\n' +
        '    (a ~/.npmrc line for //npm.pkg.github.com/).'
      )
    }
    if (published !== version) {
      throw new Error(`${full}: registry served ${published}, expected ${version}`)
    }
    console.log(`  verified ${full}@${version}`)
  }
}

// ── Discovery ──────────────────────────────────────────────────────────────

/**
 * Every website, derived from the template link GitHub records permanently.
 *
 * The same rule drives package-ci.yml's downstream matrix, so the set of
 * repositories validated before a release and the set updated after it cannot
 * drift apart. There is no list to maintain.
 *
 * Blind spot, accepted knowingly: this finds repositories OWNED by the
 * template's owner that still carry the link. A site created by fork or
 * transferred in is invisible — pass it with --repo.
 */
function discoverSites(owner) {
  const names = gh([
    'api', `users/${owner}/repos?per_page=100&type=owner`, '--paginate',
    '--jq', '.[] | select(.archived == false) | .name',
  ]).split('\n').filter(Boolean)

  const sites = []
  for (const name of names) {
    const template = gh([
      'api', `repos/${owner}/${name}`, '--jq', '.template_repository.full_name // ""',
    ])
    if (template === `${owner}/${TEMPLATE_REPO}`) sites.push(`${owner}/${name}`)
  }
  return sites.sort()
}

// ── Per-site work ──────────────────────────────────────────────────────────

/** Every @metanull dependency a site declares, from its own manifest. */
function metanullDeps(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((name) => name.startsWith(`${SCOPE}/`))
    .sort()
}

function propagateTo(repo, { dryRun, merge }) {
  const work = mkdtempSync(join(tmpdir(), 'propagate-'))
  try {
    gh(['repo', 'clone', repo, work, '--', '--depth', '1'], { stdio: 'pipe' })

    const deps = metanullDeps(work)
    if (!deps.length) return { repo, status: 'skipped', detail: `no ${SCOPE} dependencies` }

    const before = readFileSync(join(work, 'package-lock.json'), 'utf8')

    // `npm install <pkg>@latest` rather than `npm update`: update only moves
    // within the declared range, so it would silently do nothing whenever a
    // release falls outside it — which is every minor release while a package
    // is still 0.x. install@latest rewrites the range as well as the lockfile,
    // which is what "adopt the published version" actually means.
    run('npm', ['install', ...deps.map((d) => `${d}@latest`), '--no-audit', '--no-fund'], {
      cwd: work,
      stdio: 'pipe',
    })

    const after = readFileSync(join(work, 'package-lock.json'), 'utf8')
    if (before === after) return { repo, status: 'current', detail: 'already at latest' }

    const versions = deps
      .map((d) => {
        const pkg = JSON.parse(readFileSync(join(work, 'package.json'), 'utf8'))
        return `${d}@${(pkg.dependencies?.[d] ?? pkg.devDependencies?.[d] ?? '').replace('^', '')}`
      })
      .join(', ')

    if (dryRun) return { repo, status: 'would-update', detail: versions }

    run('git', ['checkout', '-b', BRANCH], { cwd: work, stdio: 'pipe' })
    run('git', ['add', 'package.json', 'package-lock.json'], { cwd: work, stdio: 'pipe' })

    // Outside the clone: a file written inside it would be an untracked change,
    // and `gh pr create` warns about a dirty tree.
    const body = join(tmpdir(), `propagate-message-${process.pid}`)
    writeFileSync(
      body,
      `chore(deps): adopt the published ${SCOPE} packages\n\n` +
      `${versions}\n\n` +
      'Opened by tools/propagate.mjs in metanull/viewer-workflows. The release\n' +
      'was already built against this site by the package repository\'s own CI\n' +
      'before it was published; this pull request re-runs that check here, in\n' +
      'context, before the site adopts it.\n'
    )
    run('git', ['commit', '-F', body], { cwd: work, stdio: 'pipe' })
    run('git', ['push', '-u', 'origin', BRANCH], { cwd: work, stdio: 'pipe' })

    // --head is required alongside --repo: with an explicit repo, `gh` does not
    // infer the branch from the working directory.
    const url = gh(['pr', 'create', '--repo', repo, '--head', BRANCH, '--fill'], { cwd: work })
    if (merge) gh(['pr', 'merge', url, '--repo', repo, '--auto', '--squash'], { cwd: work })

    return { repo, status: dryRun ? 'would-update' : 'opened', detail: url }
  } catch (error) {
    // One site failing must not stop the rest; the summary reports it.
    const message = String(error.stderr || error.message).split('\n').slice(0, 3).join(' ')
    return { repo, status: 'failed', detail: message }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const { expect, repos, dryRun, merge } = parseArgs(process.argv.slice(2))
const owner = gh(['api', 'user', '--jq', '.login'])

console.log('Verifying the registry serves the expected versions')
verifyPublished(expect)

const sites = repos.length ? repos : discoverSites(owner)
console.log(`\n${sites.length} website(s):`)
for (const site of sites) console.log(`  ${site}`)

console.log(`\nPropagating${dryRun ? ' (dry run)' : ''}`)
const results = sites.map((site) => {
  const result = propagateTo(site, { dryRun, merge })
  console.log(`  ${result.status.padEnd(12)} ${result.repo}  ${result.detail}`)
  return result
})

const failed = results.filter((r) => r.status === 'failed')
console.log(`\n${results.filter((r) => r.status === 'opened').length} opened, ` +
  `${results.filter((r) => r.status === 'current').length} already current, ` +
  `${failed.length} failed`)

if (failed.length) {
  console.log('\nFailed:')
  for (const f of failed) console.log(`  ${f.repo}: ${f.detail}`)
  process.exit(1)
}
