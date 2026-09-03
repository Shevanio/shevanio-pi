# Operate Shevanio Pi CI

GitHub Actions CI is active. Every pull request and every push to `main` runs one required job whose exact check context is `verify`.

← [Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

## Quick path

1. Open a pull request to `main`.
2. Confirm the `verify` check is attached to the current head commit.
3. Merge normally only after `verify` succeeds and the branch is up to date.

Do not substitute a similarly named check, a workflow title, or a local command for the live `verify` context required by branch protection.

## CI contract

Source: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

| Surface | Current contract |
| --- | --- |
| Workflow | `CI` |
| Triggers | Every `pull_request`; every push to `main` |
| Required check | `verify`, produced by the GitHub Actions app |
| Runner | `ubuntu-latest` |
| Toolchain | Node.js 24; pnpm 11.1.1; frozen lockfile |
| Permissions | Workflow-level `contents: read` only |
| Branch protection | `main` requires `verify`, with strict/up-to-date status checks and pull requests required |

The `verify` job runs these steps in order:

```bash
pnpm install --frozen-lockfile
GENTLE_PI_REQUIRE_NATIVE_BINARY=1 pnpm test
pnpm run check:runtime-modules
node scripts/verify-package-files.mjs
pnpm run test:packed-package
```

`GENTLE_PI_REQUIRE_NATIVE_BINARY=1` makes missing package-local native runtime evidence fail rather than skip. Package verification and the packed-install test are separate gates; a passing unit suite does not replace either one.

## Local equivalent

Use Node.js 24 and pnpm 11.1.1, then run the same sequence from the repository root:

```bash
pnpm install --frozen-lockfile
GENTLE_PI_REQUIRE_NATIVE_BINARY=1 pnpm test
pnpm run check:runtime-modules
node scripts/verify-package-files.mjs
pnpm run test:packed-package
```

For documentation-only edits, start with the package-file verifier and Markdown/link checks. The required PR `verify` run remains the functional proof; do not rerun equivalent semantic suites without a concrete reason.

## Branch protection

`main` follows the repository's issue-first pull-request flow. Protection requires:

- a pull request, with no mandatory approving-review count;
- the exact GitHub Actions check `verify` from the current commit;
- strict status checks, so the candidate must be up to date with `main`;
- no force pushes or branch deletion.

Issue linkage, `status:approved`, and exactly one `type:*` label remain repository policy. They are documented in [CONTRIBUTING.md](../CONTRIBUTING.md) and the pull-request template; `.github/workflows/ci.yml` does not claim to validate them.

## Publication workflow

Source: [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)

The publication workflow is separate from CI. It has only a manual `workflow_dispatch` trigger, targets the `npm` environment, and grants `id-token: write` only to its publish job for trusted OIDC publication. Its source also verifies canonical package/repository identity, exact annotated tag and version binding, protected remote `main`, package contents, and remote authority again immediately before publication.

It is currently **non-operational by design**:

- `shevanio-pi` is unpublished on npm;
- the GitHub repository has no `npm` environment;
- npm trusted publishing has not been separately authorized or configured;
- no publication run has been dispatched.

Do not dispatch it, create the environment, configure credentials or OIDC trust, tag, release, or change the package version during ordinary CI work. Those actions require a separate, explicit publication authorization.
