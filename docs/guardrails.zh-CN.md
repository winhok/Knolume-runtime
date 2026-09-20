# 安全护栏

[English](guardrails.md) | 简体中文 · [返回 README](../README.zh-CN.md)

`agentLoop` 接受宿主提供的 `guardrails`。运行时负责调度和执行边界；应用负责规则、身份上下文、提示词与模型。

## 配置

以下片段展示接入方式；`model`、`toolRuntime`、`messages`、`system`、`trustedContext`、`classifyRequest` 和 `violatesPolicy` 均由宿主提供。

```ts
import { agentLoop } from "@knolume/runtime";

const result = await agentLoop({
  model,
  toolRuntime,
  messages,
  system,
  guardrails: {
    inputMode: "parallel", // blocking 模式在推理前完成检查
    context: trustedContext,
    input: [
      {
        name: "request-policy",
        timeoutMs: 10_000,
        execute: async ({ text, messages, context, signal }) => {
          const verdict = await classifyRequest({ text, messages, context, signal });
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

检查器可以调用其他模型或 `agentLoop`，但不要把同一个语义检查器递归挂到它自己的分类调用上。缺失或格式错误的判定会作为错误处理，不会默认放行。

`toolInput` 和 `toolOutput` 使用相同接口，并提供 `tool`、`input`、`output` 字段。它们包装 SDK 工具；最终授权，以及 Hook 修改参数后的校验，仍需放在工具执行流水线中。

## 执行与交付边界

- 并行输入检查允许提前启动推理，但会阻止工具执行和 SDK 输入回调越过检查。拒绝时取消共享信号；已经发生的模型调用可能消耗 token。
- 启用护栏的 Run 会缓冲内容事件、轨迹内容和 `onStepUsage` 回调，直到检查全部通过。输出检查包含中间步骤在内的所有生成文本和追加消息，因此内容流式交付会延迟。
- 检查过程中使用临时消息。被拒绝的候选内容不会进入调用方历史、内容回调、事件接收器或轨迹。`prepareNextStep` 仅用于当前 Run 的可信上下文压缩，不能发布或持久化候选内容。用量统计仍可记录被拒绝请求消耗的 token。
- 每条检查默认执行拦截，超时为 10 秒。`mode: "shadow"` 只记录本应拦截的结果、错误和超时，不提供拦截保护。
- `guardrail_checked` 事件包含名称、阶段、模式与结果。规则名和上下文应来自可信配置；检查器错误和判定内容不会复制到审计事件。`GuardrailError` 区分 `blocked`、`invalid`、`timeout`、`error`、`buffer_limit`、`unsupported_tool` 和 `cancellation_incomplete`。
- 内容事件与延迟回调共用缓冲限制，默认最多 2,000,000 个序列化字符，可通过 `maxBufferChars` 调整。取消后最多等待 `cancellationTimeoutMs`（默认 2 秒）让模型和工具任务结束。忽略取消信号的工具仍可能完成副作用，运行时不承诺回滚。
- 启用护栏时拒绝 provider 执行的工具，因为本地检查无法控制其执行。异步迭代工具仅返回最终通过检查的结果。
- 将父 Run 的宿主护栏配置传入 `SpawnContext.guardrails`，可让子 Run 使用同样的检查。子任务请求不能禁用这些检查。

工具输出检查发生在工具执行之后，保护的是模型上下文和内容交付，不能撤销之前的副作用。资源权限、审批、网络限制和沙箱仍由宿主落实。不传 `guardrails` 时保留原有流式行为。

## 调度与评估

`GuardrailScheduler` 限制宿主共享分类器的并发和队列长度。通过 `scheduler.run(signal, operation)` 传入检查信号。排队期间取消会移除等待任务；已启动任务即使调用方超时，也会持续占用槽位，直到实际结束。队列耗尽会抛错；Enforce 模式按失败处理，Shadow 模式记录错误。

`evaluateGuardrailCorpus`、`loadGuardrailCorpus`、`validatePromotionReport` 和 `validatePromotionEvidence` 提供报告生成与校验。宿主选择分类、误拦截阈值及所需外部证据。报告绑定策略版本、语料、分类器配置及报告原始字节；校验器重新计算指标并拒绝重复样本 ID。取消和副作用计数必须来自实际观测。测试分类器不能证明真实服务商行为。

审计记录可附带 `policyVersion`、SHA-256 `requestHash`、`durationMs` 与实际测得的 `addedTokens`，不包含候选文本或分类器错误。宿主通过自己的事件日志持久化和汇总记录。

## 输出恢复

输出规则默认必须通过，只有显式标记 `reviewable: true` 才能进入人工复核。判定还可针对高风险内容返回 `reviewable: false`。强制规则失败，以及超时、错误、无效判定均不进入恢复。

可选的 `repairOutput({ text, rule, requestHash, signal })` 有一次修复机会，之后重新执行完整校验。可选的 `reviewOutput(...)` 对该候选内容和单条规则返回布尔判定；其他规则继续执行，复核不能禁用整个策略。恢复受 `recoveryTimeoutMs` 限制，默认 5 分钟。宿主必须绑定复核身份、有效期和一次性消费。

恢复会丢弃被拒绝的对话和延迟内容回调，只重放最终获准的 assistant 文本。输出拦截前已经发生的工具副作用不会回滚。

## Run 内 Skill 一致性

`SkillLoader.createView()` 捕获 Skill 定义的冻结副本。在同一次 Run 中，提示词构建、Skill 调用及子 Agent 工具应使用同一个 `SkillView`。重新加载 Loader 不会改变已经运行的视图。
