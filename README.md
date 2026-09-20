# Knolume Runtime

English | [简体中文](README.zh-CN.md)

A composable TypeScript agent runtime for model execution, tools, context, memory, retrieval, guardrails, and sub-agents. Applications supply their own models, prompts, tools, and policies through the `@knolume/runtime` library.

For Node.js applications that need control over tool permissions, context lifecycle, and execution records. Compose the modules you need while keeping product decisions in the host.

[Quick start](#run-locally) · [Integration](#use-in-an-application) · [Verification](#verification) · [Guardrails](docs/guardrails.md)

## Core capabilities

| Capability | Implementation |
| --- | --- |
| Agent loop, streaming events, retries, cancellation, and loop detection | [`src/harness/agent/`](src/harness/agent/) |
| Tool registration, execution, capability filtering, permissions, approvals, and hooks | [`src/tools/`](src/tools/) |
| MCP tool contracts and adapters (host-provided client) | [`src/tools/mcp/`](src/tools/mcp/) |
| Prompt assembly, project rules, compression, and context limits | [`src/harness/context/`](src/harness/context/) |
| Memory storage, search, and validation | [`src/harness/memory/`](src/harness/memory/) |
| Document chunking, embeddings, SQLite vector search, and retrieval | [`src/harness/rag/`](src/harness/rag/) |
| Input, tool, and output guardrails; evaluation and recovery | [`src/harness/guardrails/`](src/harness/guardrails/) |
| Skill loading and frozen per-run views | [`src/harness/skills/`](src/harness/skills/) |
| Sub-agent profiles, dispatch, and run tracking | [`src/harness/agents/`](src/harness/agents/) |
| Session persistence, traces, and usage records | [`session/`](src/harness/session/), [`trace/`](src/harness/trace/), [`usage/`](src/harness/usage/) |
| Run, tool, approval, workspace, and transfer schemas | [`src/protocol/`](src/protocol/) |

## Run locally

Use Node.js 26 and pnpm 12.5.1, as specified in [`package.json`](package.json). Native SQLite dependencies may require a C/C++ build toolchain when no prebuilt binary is available.

```sh
git clone https://github.com/winhok/Knolume-runtime.git
cd Knolume-runtime
pnpm install --frozen-lockfile
pnpm build
pnpm example
```

The [example](examples/basic-agent.mjs) runs the agent loop with a deterministic model and requires no credentials or network calls. It prints:

```text
Hello from Knolume Runtime!
run_started → step_started → text_delta → step_finished → run_finished
```

## Use in an application

Install a versioned package asset from [GitHub Releases](https://github.com/winhok/Knolume-runtime/releases). For `v0.4.0`:

```sh
pnpm add https://github.com/winhok/Knolume-runtime/releases/download/v0.4.0/knolume-runtime-0.4.0.tgz
```

The package has three main entry points:

```ts
import { agentLoop, type AgentToolRuntime } from "@knolume/runtime";
import { ToolRegistry, ToolExecutionPipeline } from "@knolume/runtime/tools";
import { createAgentRunRequestSchema } from "@knolume/runtime/protocol";
```

Pass an AI SDK `LanguageModel`, messages, a system prompt, and an `AgentToolRuntime` to `agentLoop`. The tool runtime implements `getTools(selection)`; the application supplies tool implementations and permission/approval policy. See the [runnable example](examples/basic-agent.mjs) and [agent-loop tests](src/harness/agent/loop.spec.ts) for integration examples.

The host also owns tenant isolation, credentials, data retention, storage access, and sandbox/network restrictions. Protocol schemas describe requests and events; the host implements the server and durable job lifecycle.

### Guardrails

Optional `guardrails` check input, tool input/output, and generated output. The runtime provides scheduling, cancellation, buffering, audit events, and recovery hooks; the host supplies rules, trusted context, and checker models.

Guarded execution buffers content until checks pass. Shadow mode records outcomes without enforcement. Output checks cannot undo tool side effects, so resource permissions and approval remain part of the host's tool execution policy.

See [Guardrails](docs/guardrails.md) for configuration, execution guarantees, evaluation, output recovery, and child-run propagation.

### Embedding caches

Embedding caches are isolated by embedding-function identity. Reuse a function for cache hits; create a new function when changing models or configuration.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm example
pnpm pack
```

Coverage uses V8 and includes all production `src/**/*.ts` files, including files not imported by tests, while excluding `*.spec.ts`. Open `coverage/index.html` for details or read `coverage/coverage-summary.json`. Generated reports are ignored by Git.

The 2026-09-21 local snapshot has **151 passing tests across 40 files**:

| Metric | Coverage |
| --- | ---: |
| Statements | 79.27% |
| Branches | 69.97% |
| Functions | 84.95% |
| Lines | 82.15% |

Tests cover session recovery, trace redaction and write failures, usage accounting, retrieval diversity, embedding failures/cache isolation, and context truncation/expiry. Remaining gaps include sub-agent orchestration, context views, SQLite search branches, and transport schemas.

Tests use temporary local files/databases, deterministic models, and mocked HTTP. These results do not verify live providers, retrieval quality, current provider prices, or production deployment. Rerun coverage after code changes.

## Relationship to coding-agent

Knolume Runtime carries forward the reusable core extracted from [coding-agent](https://github.com/winhok/coding-agent), previously named Runframe. Core runtime development continues here; the archived repository preserves the coding application and its CLI, Feishu, and scheduled-task integrations.

In the historical application, [`src/index.ts`](https://github.com/winhok/coding-agent/blob/main/src/index.ts) starts the CLI, while [`src/main.ts`](https://github.com/winhok/coding-agent/blob/main/src/main.ts) assembles models, tools, configuration, Feishu, and Cron.

This package exposes runtime APIs and transport schemas. Your application owns the entry points, authentication, HTTP/SSE transport, product configuration, and concrete file, shell, Git, or business tools. Migrating from coding-agent requires adapting those integrations and checking persisted data formats; the two repositories are not interchangeable packages.

## Development

Develop runtime changes here and pin a versioned release asset in consuming applications. Commit the consumer lockfile and retain older assets for rollback. `pnpm pack` builds the package before creating the archive.

For AI SDK integration work, the optional [official Vercel skill](https://github.com/vercel/ai/tree/main/skills/use-ai-sdk) covers streaming, tools, messages, and usage. A one-off v6-to-v7 migration review can use:

```sh
npx skills use vercel/ai@migrate-ai-sdk-v6-to-v7
```

The runtime already uses AI SDK 7; ordinary v7 patch upgrades do not require this migration skill. Contributor skills are development aids, not runtime dependencies.

## Help and contributions

Use [Issues](https://github.com/winhok/Knolume-runtime/issues) for bug reports and feature requests. Include a minimal reproduction, Node.js/pnpm/package versions, and relevant errors; remove credentials and user data.

Focused pull requests are welcome. Add tests for behavior changes, keep English and Chinese documentation aligned for API changes, and run the verification commands above. Maintained by [winhok](https://github.com/winhok).

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
