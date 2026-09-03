# Contributing to Shevanio Pi

Contributions use an approved issue, one focused branch, one coherent commit, and a pull request whose required `verify` check passes.

## Quick path

1. Search existing issues and use the repository issue form when no approved issue already covers the work.
2. Wait for the issue to carry `status:approved`.
3. Branch from current `main` using `type/short-description`.
4. Make one reviewable work unit and run the relevant local checks.
5. Open a pull request with `Closes #N` and exactly one existing `type:*` label.
6. Merge only after the required live `verify` check succeeds.

See [CI operations](docs/ci.md) for the exact workflow contract and local equivalent.

## Development setup

Requirements: Git, Node.js 24, and pnpm 11.1.1.

```bash
git clone https://github.com/Shevanio/shevanio-pi.git
cd shevanio-pi
pnpm install --frozen-lockfile
node scripts/verify-package-files.mjs
```

`shevanio-pi` and `shevanio-engram` are not published on npm. Do not substitute a canonical npm install command. Existing `gentle-pi` and `gentle-engram` packages are upstream transitional compatibility packages, not canonical development dependencies for this repository.

## Pull-request contract

| Requirement | Rule |
| --- | --- |
| Issue | Link one issue carrying `status:approved` with `Closes`, `Fixes`, or `Resolves`. |
| Branch | Match `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$`. |
| Commit | Use a conventional commit and do not add AI attribution. |
| Label | Add exactly one existing `type:*` label that describes the change. |
| Size | Keep authored additions plus deletions at or below 400, or add `size:exception` only with explicit maintainer approval. |
| CI | Require the exact GitHub Actions check `verify`; do not infer success from a differently named local check. |

Use [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) as the review checklist. Issue approval and label selection are repository policy checks; the current CI workflow does not claim to automate them.

## Local verification

Run the cheapest relevant check while editing. Before delivery, run the checks appropriate to the changed surface and record exact outcomes in the pull request.

For the complete CI-equivalent sequence, use [docs/ci.md](docs/ci.md#local-equivalent). Avoid duplicate semantic suites when the same result is already covered by the required PR run.

## Publication boundary

Do not publish, tag, release, or dispatch `.github/workflows/publish.yml` as part of normal contribution work. The workflow is manual, gated, and currently non-operational until a separate authorization creates the `npm` environment and configures npm trusted publishing.
