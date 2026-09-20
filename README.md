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
pnpm add https://github.com/winhok/Knolume-runtime/releases/download/v0.3.0/knolume-runtime-0.3.0.tgz
```

```ts
import { agentLoop, type AgentToolRuntime } from "@knolume/runtime";
import { ToolRegistry, ToolExecutionPipeline } from "@knolume/runtime/tools";
import { createAgentRunRequestSchema } from "@knolume/runtime/protocol";
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

## Guardrails

`agentLoop` accepts host-owned `guardrails`. Runtime provides scheduling and execution
boundaries; your application owns the rules, identity context, prompts and models.

```ts
import { agentLoop, GuardrailError } from "@knolume/runtime";

const result = await agentLoop({
  model,
  toolRuntime,
  messages,
  system,
  guardrails: {
    inputMode: "parallel", // "blocking" checks before starting inference
    context: trustedContext,
    input: [
      {
        name: "request-policy",
        timeoutMs: 10_000,
        execute: async ({ text, messages, context, signal }) => {
          const verdict = await classifyRequest({
            text,
            messages,
            context,
            signal,
          });
          return { tripwireTriggered: verdict.blocked };
        },
      },
    ],
    output: [
      {
        name: "response-policy",
        execute: ({ text, messages }) => ({
          tripwireTriggered: violatesPolicy(text, messages),
        }),
      },
    ],
  },
});
```

The example's model, tools, classifier and policy functions are host dependencies.
Checks can call another model or `agentLoop`; do not recursively attach the same
semantic checker to its own classifier. Missing or malformed decisions are errors,
never an implicit pass. `toolInput` and `toolOutput` use the same interface with
`tool`, `input` and `output` fields. These wrap SDK tools; authoritative authorization
and validation of hook-modified arguments must remain in the tool execution pipeline.

- Parallel input checks allow speculative inference, but gate tool execution and
  SDK input callbacks. Rejection cancels the shared signal. Tokens may be consumed.
- Guarded runs buffer content events, trace content and `onStepUsage` callbacks until
  all checks pass. Output checks receive all emitted text and appended messages,
  including intermediate steps. This mode delays streaming until validation finishes.
- Only temporary messages are used during guarded execution. Rejected candidates
  do not reach the caller's history, content callbacks, event sink or trace.
  `prepareNextStep` is a trusted, run-local compaction hook: never publish or persist
  from it. Usage accounting can record consumed tokens even for rejected requests.
- Each check defaults to enforcement and a 10-second deadline. `mode: "shadow"`
  records would-block/errors/timeouts without enforcing. Shadow is not protection.
- `guardrail_checked` events contain only name, stage, mode and outcome. The rule
  names and context must come from trusted configuration. Checker errors/decisions
  are not copied into audit events. `GuardrailError` distinguishes blocked, invalid,
  timeout, error, buffer_limit, unsupported_tool and cancellation_incomplete.
- Buffering defaults to 2,000,000 serialized characters across content events and
  deferred callbacks. `maxBufferChars` controls this bound. Cancellation waits at
  most `cancellationTimeoutMs` (default 2 seconds) for model/tool work to settle.
  A tool ignoring cancellation may still finish its side effect; no rollback is claimed.
- Provider-executed tools are rejected for guarded runs because local gates cannot
  control them. Async iterable tools return only their final checked result.
- Set `SpawnContext.guardrails` to the parent's host-owned configuration to apply
  the same checks to child runs. Child requests cannot disable those checks.

Tool output checks happen after tool execution; they protect model context and
content delivery, not earlier side effects. Keep resource permissions, approvals,
network restrictions and sandbox enforcement in the host. Omitting `guardrails`
preserves the original streaming behavior.

### Guardrail governance and output recovery (0.3)

`GuardrailScheduler` bounds host-shared classifier concurrency and queue size. Pass the checker signal to `scheduler.run(signal, operation)`. Queued cancellation removes the waiter; active work retains its slot until it actually settles, even if a caller times out. An exhausted queue throws; Enforce remains fail-closed and Shadow records the error.

`evaluateGuardrailCorpus`, `loadGuardrailCorpus`, `validatePromotionReport` and `validatePromotionEvidence` provide report generation and validation. The host chooses categories, false-block threshold and required external evidence. Reports bind policy version, corpus, classifier configuration and exact report bytes; validators recalculate metrics and reject duplicate sample IDs. Runtime cancellation/effect counters must come from observed execution, never invented values. A fixture classifier is not provider evidence.

Audit entries optionally include `policyVersion`, SHA-256 `requestHash`, `durationMs` and measured `addedTokens`. These contain no candidate text or classifier error. The host persists and aggregates them using its own event journal.

Output rules are mandatory unless explicitly marked `reviewable: true`. A decision may additionally return `reviewable: false` for high-risk content. Mandatory failures and timeout/error/invalid results never enter recovery. An optional `repairOutput({text, rule, requestHash, signal})` gets one attempt, followed by full revalidation. An optional `reviewOutput(...)` returns a boolean for that exact candidate and one rule. Other rules still run; review cannot disable the policy. Recovery has a bounded `recoveryTimeoutMs` (default five minutes). The host must bind review identity, expiry and one-time consumption. Recovery discards the rejected transcript and deferred content callbacks; only the accepted final assistant text is replayed. Real tool side effects performed before an output block are not rolled back.

`SkillLoader.createView()` captures frozen copies of skill definitions. Use the same `SkillView` for prompt construction, skill invocation and child-agent tools throughout a Run. Reloading the loader cannot change a running view.
