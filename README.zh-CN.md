# Knolume Runtime

[English](README.md) | 简体中文

可组合的 TypeScript Agent 运行时，提供模型执行、工具、上下文、记忆、检索、安全护栏与子 Agent 能力。应用通过 `@knolume/runtime` 库接入自己的模型、提示词、工具和策略。

适用于需要自行控制工具权限、上下文生命周期和执行记录的 Node.js 应用。各模块可以按需组合，宿主保留产品层决策。

[本地运行](#本地运行) · [接入应用](#接入应用) · [验证](#验证) · [安全护栏](docs/guardrails.zh-CN.md)

## 核心能力

| 能力 | 实现位置 |
| --- | --- |
| Agent 循环、流式事件、重试、取消与循环检测 | [`src/harness/agent/`](src/harness/agent/) |
| 工具注册、执行、能力过滤、权限、审批与 Hooks | [`src/tools/`](src/tools/) |
| MCP 工具契约与适配器（客户端由宿主提供） | [`src/tools/mcp/`](src/tools/mcp/) |
| 提示词组装、项目规则、压缩与上下文限制 | [`src/harness/context/`](src/harness/context/) |
| 记忆存储、检索与校验 | [`src/harness/memory/`](src/harness/memory/) |
| 文档分块、Embedding、SQLite 向量搜索与检索 | [`src/harness/rag/`](src/harness/rag/) |
| 输入、工具与输出护栏，以及评估和恢复 | [`src/harness/guardrails/`](src/harness/guardrails/) |
| Skill 加载与每次 Run 的冻结视图 | [`src/harness/skills/`](src/harness/skills/) |
| 子 Agent Profile、派发与运行记录 | [`src/harness/agents/`](src/harness/agents/) |
| 会话持久化、执行轨迹与用量记录 | [`session/`](src/harness/session/)、[`trace/`](src/harness/trace/)、[`usage/`](src/harness/usage/) |
| Run、工具、审批、工作区与传输 Schema | [`src/protocol/`](src/protocol/) |

## 本地运行

使用 [`package.json`](package.json) 指定的 Node.js 26 和 pnpm 12.5.1。原生 SQLite 依赖在没有可用预编译二进制时，可能需要本地 C/C++ 构建工具链。

```sh
git clone https://github.com/winhok/Knolume-runtime.git
cd Knolume-runtime
pnpm install --frozen-lockfile
pnpm build
pnpm example
```

[示例](examples/basic-agent.mjs) 使用确定性模型运行 Agent 循环，无需凭证，也不发起网络请求。输出如下：

```text
Hello from Knolume Runtime!
run_started → step_started → text_delta → step_finished → run_finished
```

## 接入应用

从 [GitHub Releases](https://github.com/winhok/Knolume-runtime/releases) 安装指定版本的包产物。`v0.4.0` 的安装方式为：

```sh
pnpm add https://github.com/winhok/Knolume-runtime/releases/download/v0.4.0/knolume-runtime-0.4.0.tgz
```

包提供三个主要入口：

```ts
import { agentLoop, type AgentToolRuntime } from "@knolume/runtime";
import { ToolRegistry, ToolExecutionPipeline } from "@knolume/runtime/tools";
import { createAgentRunRequestSchema } from "@knolume/runtime/protocol";
```

向 `agentLoop` 传入 AI SDK 的 `LanguageModel`、消息、系统提示词及 `AgentToolRuntime`。工具运行时实现 `getTools(selection)`；工具实现、权限与审批策略由宿主提供。完整接入方式可参考[可运行示例](examples/basic-agent.mjs)和 [Agent 循环测试](src/harness/agent/loop.spec.ts)。

租户隔离、凭证、数据保留、存储访问，以及沙箱和网络限制也由宿主负责。协议 Schema 定义请求与事件，服务端和持久化任务生命周期由宿主实现。

### 安全护栏

可选的 `guardrails` 检查输入、工具输入/输出及模型输出。运行时负责调度、取消、缓冲、审计事件和恢复回调；宿主提供规则、可信上下文与检查模型。

启用护栏后，内容会缓冲到检查通过后再交付。Shadow 模式只记录结果，不执行拦截。输出检查不能撤销工具已产生的副作用，资源权限和审批仍需在宿主的工具执行策略中落实。

配置、执行保证、评估、输出恢复和子 Run 继承方式见[安全护栏文档](docs/guardrails.zh-CN.md)。

### Embedding 缓存

Embedding 缓存按函数实例隔离。复用同一个函数可命中缓存；切换模型或配置时应创建新的函数实例。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm example
pnpm pack
```

覆盖率使用 V8，统计全部生产源码 `src/**/*.ts`，包括未被测试导入的文件，并排除 `*.spec.ts`。详细报告位于 `coverage/index.html`，机器可读结果位于 `coverage/coverage-summary.json`。生成的报告不纳入 Git。

2026-09-21 本地验证快照：**40 个测试文件、151 个测试全部通过**。

| 指标 | 覆盖率 |
| --- | ---: |
| 语句 | 79.27% |
| 分支 | 69.97% |
| 函数 | 84.95% |
| 行 | 82.15% |

测试覆盖会话恢复、轨迹脱敏与写入失败、用量统计、检索多样性、Embedding 失败与缓存隔离，以及上下文裁剪和过期清理。子 Agent 编排、上下文视图、SQLite 搜索分支与传输 Schema 仍有覆盖缺口。

测试使用临时本地文件/数据库、确定性模型与模拟 HTTP。这些结果不代表真实模型服务、检索质量、服务商现价或生产部署已验证。代码变更后应重新测量覆盖率。

## 与 coding-agent 的关系

Knolume Runtime 承接从 [coding-agent](https://github.com/winhok/coding-agent)（曾用名 Runframe）抽取的通用核心能力。核心运行时在本仓库继续开发；旧仓库已归档，保留编码应用及其 CLI、飞书和定时任务集成。

旧应用的 [`src/index.ts`](https://github.com/winhok/coding-agent/blob/main/src/index.ts) 启动 CLI；[`src/main.ts`](https://github.com/winhok/coding-agent/blob/main/src/main.ts) 组装模型、工具、配置、飞书和 Cron。

本库提供运行时 API 和传输协议定义。应用入口、身份认证、HTTP/SSE 服务、产品配置，以及文件、Shell、Git 或业务工具由宿主应用实现。从 coding-agent 迁移时，需要适配这些集成并核对持久化数据格式；两个仓库的包不能直接互换。

## 开发

运行时源码在本仓库维护，消费应用固定引用指定版本的发布产物。提交消费端锁文件，并保留旧产物以便回滚。`pnpm pack` 会先构建再打包。

维护 AI SDK 集成时，可使用可选的 [Vercel 官方 skill](https://github.com/vercel/ai/tree/main/skills/use-ai-sdk)，辅助处理流式调用、工具、消息和用量。一次性的 v6→v7 迁移检查可按需运行：

```sh
npx skills use vercel/ai@migrate-ai-sdk-v6-to-v7
```

本库已使用 AI SDK 7，普通 v7 补丁升级无需使用该迁移 skill。开发辅助 skills 不是运行时依赖。

## 帮助与贡献

通过 [Issues](https://github.com/winhok/Knolume-runtime/issues) 提交问题或功能建议。报告缺陷时请附最小复现、Node.js/pnpm/包版本及相关错误，并移除凭证与用户数据。

欢迎提交聚焦的 Pull Request；行为变更应补充测试，API 变更应同步英文和中文文档。提交前运行上面的验证命令。本项目由 [winhok](https://github.com/winhok) 维护。

## 许可证

[MIT](LICENSE)。第三方依赖保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
