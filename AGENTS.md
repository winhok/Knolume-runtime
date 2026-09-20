# Repository guidance

## Scope and architecture

- This is the single-package `@knolume/runtime` TypeScript library. Read `README.md` for the module map and integration boundary; current source and `package.json` are authoritative.
- Keep generic execution in `src/harness/`, tool contracts and policy enforcement in `src/tools/`, and transport schemas in `src/protocol/`. Hosts supply identity, providers, prompts, product tools, permissions, and HTTP/SSE entry points.
- Preserve public exports, event shapes, and persistence contracts unless the requested change explicitly requires migration. Do not import application-specific code from the archived coding-agent repository.
- Inspect the worktree before editing. Preserve unrelated changes; review requests alone do not authorize implementation. Continue ordinary, reversible work within the user's authorized scope.

## Setup and code conventions

- Use Node.js and pnpm versions specified in `package.json`; install with `pnpm install --frozen-lockfile`. This is not a workspace monorepo.
- Keep dependency changes and `pnpm-lock.yaml` synchronized. Preserve the release-age and native-build policies in `pnpm-workspace.yaml`.
- Follow adjacent TypeScript style: strict typing, ESM, `.js` relative import specifiers, and `import type` for types. Avoid unrelated refactoring or dependencies.
- Check installed package declarations and official documentation when changing SDK APIs. Load relevant skills only when useful; keep personal skill installations out of the repository.

## Validation

- Put behavior tests beside source as `*.spec.ts`. Test observable results and meaningful failure boundaries; use deterministic models, mocked HTTP, and temporary directories with cleanup.
- During implementation run focused tests with `pnpm exec vitest run <path>`. For runtime/dependency changes, run `pnpm typecheck` and `pnpm test`; for build/export changes also run `pnpm build` and `pnpm example`.
- `tsconfig.json` excludes test files. Passing the production typecheck alone does not prove test-source type safety.
- When changing coverage or reporting metrics, run `pnpm test:coverage`. Include all production sources; do not exclude difficult code or add assertion-free tests to improve percentages.
- For documentation-only changes, check links, examples, bilingual consistency, and `git diff --check`; do not rerun unchanged runtime tests mechanically.
- Before release, validate frozen-lockfile installation, typecheck, tests, build/example, and `pnpm pack`. Reuse still-valid results. Inspect the archive's version, exports, declarations, and documentation before uploading it.
- Distinguish fixture/local verification from live model, external-service, CI, or deployment evidence. Do not use credentials or incur provider costs without authorization.

## Code Review Rules

- Flag tool paths that bypass host permission/approval checks or fail to validate hook-modified arguments.
- Guardrails must preserve fail-closed enforcement, cancellation propagation, and candidate-output isolation. Shadow checks are observational; output checks cannot roll back tool effects. See `docs/guardrails.md`.
- Flag cross-run or cross-provider state leakage. Embedding caches are scoped to embedding-function identity; persistence must preserve the caller's session scope.
- Keep user content and credentials out of diagnostics and release assets. Trace field redaction is not a guarantee that arbitrary free text is secret-free.

## Documentation and delivery

- Keep the default `README.md` in English with a `README.zh-CN.md` link. Update both languages for public behavior, commands, and installation changes. Put longer guides in `docs/`.
- Keep this file concise and project-specific; link to detailed guidance instead of copying it. Add nested instructions only when a subtree genuinely needs different rules.
- Commit, push, tags, and Releases require user authorization covering those actions; reuse authorization already given for the task. Do not force-push, overwrite existing release assets, or bypass required checks.
- For an authorized release, align the package version, bilingual installation URLs, tag `vX.Y.Z`, and `knolume-runtime-X.Y.Z.tgz`. Include user-facing documentation in the package. Publish a GitHub Release with the tested archive and release notes; npm publication is a separate action.
- Stage the complete authorized change set, including relevant new files. Verify remote main/tag commit IDs and uploaded assets after publication; report commit, push, CI, and Release outcomes separately.

## References

- [OpenAI: project instructions](https://developers.openai.com/codex/guides/agents-md)
- [AGENTS.md community format](https://agents.md/)
