// Regression test for the scope migration silently breaking propagation.
//
// propagate.mjs discovers a site's platform dependencies by filtering its
// package.json for names starting with SCOPE. When every site's manifest
// moved from `@metanull/*` to `@museumwnf/*` (milestone M1) but SCOPE stayed
// `@metanull`, that filter matched nothing on any site: propagateTo()
// returned `{ status: 'skipped' }` everywhere and the whole run exited 0 — a
// silent no-op reporting success, not a crash.
//
// The fixture below mirrors metanull/islamicart's package.json dependencies
// on origin/main (confirmed 2026-09-15) — the shape every one of the seven
// sites shares after the museumwnf migration. If SCOPE ever drifts from the
// scope sites actually declare again, the second test below fails loudly
// instead of the tool silently doing nothing in production.

import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { SCOPE, expandPackageName, gitIdentityArgs, resolveGitIdentity, scopedDeps } from './propagate.mjs'

// Mirrors metanull/islamicart's package.json dependencies block.
const SITE_PACKAGE_JSON = {
  name: 'islamicart',
  private: true,
  version: '0.0.0',
  dependencies: {
    '@museumwnf/islamicart-data': '^1.0.35',
    '@museumwnf/viewer-core': '^1.15.0',
    '@museumwnf/viewer-i18n': '^3.1.1',
    '@museumwnf/viewer-layout': '^2.12.0',
    vue: '^3.5.0',
    'vue-router': '^5.0.0',
  },
  devDependencies: {
    eslint: '^10.9.1',
    vite: '^8.2.2',
  },
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'propagate-test-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(SITE_PACKAGE_JSON))
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('SCOPE is the scope sites actually declare', () => {
  assert.equal(SCOPE, '@museumwnf')
})

test('scopedDeps finds every platform/data dependency a real site declares', () => {
  withFixture((dir) => {
    assert.deepEqual(scopedDeps(dir), [
      '@museumwnf/islamicart-data',
      '@museumwnf/viewer-core',
      '@museumwnf/viewer-i18n',
      '@museumwnf/viewer-layout',
    ])
  })
})

test('scopedDeps ignores dependencies outside SCOPE', () => {
  withFixture((dir) => {
    const deps = scopedDeps(dir)
    assert.ok(!deps.includes('vue'))
    assert.ok(!deps.includes('eslint'))
  })
})

test('regression check: the old @metanull scope finds nothing on a real site', () => {
  // This is the exact failure mode the bug produced: propagateTo() treats an
  // empty list as "no dependencies to update" and reports status 'skipped'
  // instead of updating anything, on every one of the seven sites.
  withFixture((dir) => {
    assert.deepEqual(scopedDeps(dir, '@metanull'), [])
  })
})

test('expandPackageName qualifies a bare name with SCOPE', () => {
  assert.equal(expandPackageName('viewer-core'), '@museumwnf/viewer-core')
})

test('expandPackageName leaves an already-scoped name untouched', () => {
  assert.equal(expandPackageName('@other/pkg'), '@other/pkg')
})

// resolveGitIdentity() / gitIdentityArgs() — regression tests for the tool's own git commit
// failing in the documented container: `node:lts-alpine` + git + gh, mounting the repo and
// ~/.npmrc, has no ~/.gitconfig and no GIT_AUTHOR_*/GIT_COMMITTER_* env, so the first `git
// commit` used to die with "Author identity unknown" on every site propagateTo() touched,
// since the identity was never established up front, only discovered missing inside the
// per-site loop. These exercise only the precedence logic (env → local config → derived
// from the GitHub user); none of it shells out to git or the network, by construction —
// `hasLocalGitIdentity` (the one piece that does run `git config --get`) is deliberately
// not exported so the git check itself stays untested here and the injected boolean stands
// in for it.

const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'A',
  GIT_AUTHOR_EMAIL: 'a@example.com',
  GIT_COMMITTER_NAME: 'A',
  GIT_COMMITTER_EMAIL: 'a@example.com',
}

const GH_USER = { login: 'phavelange', id: 12345 }

test('resolveGitIdentity: full GIT_AUTHOR_*/GIT_COMMITTER_* env wins, even over no local identity', () => {
  assert.equal(resolveGitIdentity(GH_USER, GIT_IDENTITY_ENV, false), null)
})

test('resolveGitIdentity: a partial env (missing GIT_COMMITTER_EMAIL) does not count as an identity', () => {
  const { GIT_COMMITTER_EMAIL, ...partial } = GIT_IDENTITY_ENV
  // Falls through to the local-config check, which here says yes — so still null, but for
  // the second reason, not the first. The next test isolates that the env check alone
  // requires the complete GIT_AUTHOR_*/GIT_COMMITTER_* set, not just some of it.
  assert.equal(resolveGitIdentity(GH_USER, partial, true), null)
  assert.deepEqual(resolveGitIdentity(GH_USER, partial, false), {
    name: 'phavelange',
    email: '12345+phavelange@users.noreply.github.com',
  })
})

test('resolveGitIdentity: existing local git config wins over deriving one, when env is unset', () => {
  assert.equal(resolveGitIdentity(GH_USER, {}, true), null)
})

test('resolveGitIdentity: derives login + id into the conventional GitHub no-reply address', () => {
  assert.deepEqual(resolveGitIdentity(GH_USER, {}, false), {
    name: 'phavelange',
    email: '12345+phavelange@users.noreply.github.com',
  })
})

test('resolveGitIdentity: throws one clear error, not a git failure, when nothing is available', () => {
  assert.throws(() => resolveGitIdentity({}, {}, false), /No git commit identity is available/)
  assert.throws(() => resolveGitIdentity(null, {}, false), /No git commit identity is available/)
})

test('resolveGitIdentity: throws when the GitHub user is missing a login or id', () => {
  assert.throws(() => resolveGitIdentity({ login: 'x' }, {}, false), /No git commit identity/)
  assert.throws(() => resolveGitIdentity({ id: 1 }, {}, false), /No git commit identity/)
})

test('gitIdentityArgs: null identity (git already has one) injects nothing', () => {
  assert.deepEqual(gitIdentityArgs(null), [])
})

test('gitIdentityArgs: a derived identity becomes per-invocation -c flags, not global config', () => {
  assert.deepEqual(
    gitIdentityArgs({ name: 'phavelange', email: '12345+phavelange@users.noreply.github.com' }),
    ['-c', 'user.name=phavelange', '-c', 'user.email=12345+phavelange@users.noreply.github.com']
  )
})
