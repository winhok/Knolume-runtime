# Knolume Runtime

A TypeScript agent runtime for applications that own their prompts, identity, tools and execution policies. Licensed under MIT.

## Capabilities

- Agent loop with streaming events, retries, cancellation and loop detection.
- Tool registry, capability filtering, approval callbacks and execution hooks.
- Memory, SQLite-backed sessions, retrieval, context compression and prompt assembly.
- Skills loading, sub-agent coordination, trace and usage records.
- MCP tool adapters and generic tool discovery. Product tools are supplied by the host.
- Zod schemas for run, event, tool, approval and workspace transport contracts.

This repository provides a library. The host supplies the model, authentication, authorization, product configuration, tool implementations and any HTTP/SSE transport. Product applications and domain logic are maintained separately.

## Quick start

Requires Node.js 26 and pnpm 11. Native SQLite dependencies may need a local C/C++ build toolchain when a prebuilt binary is unavailable.

```sh
git clone https://github.com/winhok/Knolume-runtime.git
cd Knolume-runtime
pnpm install --frozen-lockfile
pnpm build
pnpm example
pnpm test
```

The example uses a deterministic model and makes no API calls. It demonstrates the actual agent loop and event stream; it is not evidence of a live model integration.

## Use in an application

The initial release distributes a built package as a GitHub Release asset; it is not published to the npm registry.

```sh
pnpm add https://github.com/winhok/Knolume-runtime/releases/download/v0.1.1/knolume-runtime-0.1.1.tgz
```

```ts
import { agentLoop, type AgentToolRuntime } from '@knolume/runtime';
import { ToolRegistry, ToolExecutionPipeline } from '@knolume/runtime/tools';
import { createAgentRunRequestSchema } from '@knolume/runtime/protocol';
```

Pass an AI SDK `LanguageModel` and an `AgentToolRuntime` to `agentLoop`. The host implements `getTools(selection)` and must enforce authorization and approval when executing tools. See [the runnable example](examples/basic-agent.mjs) and [loop tests](src/harness/agent/loop.spec.ts) for the complete options and tool-call flow.

## Boundaries

- Run/event schemas define a protocol; they do not start a server or persist a durable job queue.
- Host policy determines which tools are registered and what each run may access.
- File, shell, search and Git tool implementations, input schemas and command policies belong to private products. None are bundled here. The host supplies `permissionPolicy` to the execution pipeline; the runtime enforces its allow/ask/deny result and approval flow.
- Memory, traces and session stores can contain user content. The host owns tenant isolation, retention and storage permissions.
- Model and embedding credentials are provided by the host, never by this package.

## Development and releases

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm example
pnpm pack
```

Source changes belong here. Consumers pin a release asset and commit their lockfile. Release assets contain compiled code and declarations; Git history contains source and tests. Keep previous artifacts available so consumers can roll back their dependency and lockfile together.

Third-party dependencies retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
