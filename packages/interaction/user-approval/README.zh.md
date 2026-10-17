---
description: "与通道无关的审批服务，支持单次决定及同一会话中的操作类别授权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-user-approval

[English](README.md) | 中文

## 概述

使用本包可要求敏感工具操作在继续前取得决定。`ask` 策略咨询部署中的应答者；`never` 不提示而直接拒绝普通请求。应答者缺失或失败时返回 `unavailable`。可信请求方可在当前会话中为某个操作类别和目标范围提供授权。每个请求、决定及授权复用均会审计。模型会看到最终工具结果与当前策略，但不会看到人类权限 UI 或审计事件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`setAutomaticApproval(session, enabled)` 接收可信产品从已记录用户选择投影出的显式授权。它放行普通与强制请求，包括 `never` 策略下的请求，并通过撤回应答者信号结束已显示的审批。取消、决定提交前撤销授权及审计失败仍会阻止执行。本服务不持久保存该标志，所属产品必须负责重建、限制和撤销。没有此标志时，原有策略与同类操作授权行为不变。

当敏感工具操作应当暂停等待人或机器的决定、而非无条件执行时，组合此服务。工具流水线与沙箱 bash 工具会通过此 seam 路由 `ask` 决定，并在该 seam 缺失时以拒绝方式关闭，因此交互式部署至少应组合一个应答者。

### 组合应答者

应答者是 `approval/request` waterfall（瀑布式事件）监听器：返回一个结果即为所负责的 agent（智能体）作答，否则调用 `next()` 委托。限定到 agent 的监听器只接收该 agent 的请求，且每项部署应组合一个最终应答者——同级监听器的顺序不是策略优先级机制。没有最终应答者时，请求解析为 `unavailable` 并以拒绝方式关闭；服务自身绝不会提示人类。

### 设置策略

有效策略取会话中已设置的策略，并回退到配置的默认值。`ask`（默认）委托给已组合的应答者；`never` 在交互式分发之前确定性地拒绝每个普通请求。强制确认使用 `requestMandatory`，没有应答或匹配的显式会话授权时仍以拒绝方式关闭。

```yaml
- name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: ask
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `policy` | `ask` | 没有 `approval/policy` 覆盖的会话的默认策略 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-user-approval)是每个受支持字段及其 JSDoc 的穷尽式真源。`setPolicy(agent, policy)` 切换运行中的 agent 的策略，并为它的下一个模型步骤排队一条「由用户更改」消息；`setApprovalPolicy(session, policy)` 是会话初始化使用的直接持久写入路径。

### 请求决定

`request(req)` 指名 agent、工具、原因、可选的调用 id，以及一个中止信号。可选的 `displayReason` 提供本地化展示文案，不改写日志中的原因。它要求当前处于尚未结束的轮次中：空闲或在轮次之间调用会在审计前抛出异常。中止会撤回问题——请求以 `cancelled` 结算，迟到的回答被丢弃。若任一审计事件在提交前失败，请求会被拒绝，而不会返回一项未记录的决定。

可信请求方代码可提供 `reusable: { category, scope, label, displayLabel? }`，模型不得选择这些值。`category` 指明操作类别，`scope` 指明精确目标；`label` 与可选本地化 `displayLabel` 向用户解释两者。应答者随后可返回 `allowed-session`。服务仍返回原有 `allowed-once` 结果，授权仅在同一 Session 中复用于类别和范围均匹配的请求。未分类请求仍为单次审批。强制确认的消费方必须显式允许复用；未分类的删除确认仍逐次确认。

同类并发请求等待首个决定和审计提交，再检查授权。创建和复用写入可选审计字段；当前对象的授权仅在决定追加成功后可立即复用。重启后只恢复原本已关闭轮次中的授权；中断轮次的修复不会授权未完成尾部。较早闭合轮次的授权仍有效，复制的历史不会授权其他 Session。普通 `never` 即使存在匹配授权也仍拒绝。

### 模型与用户看到什么

模型只会看到发起请求的消费方最终给出的工具结果——允许、拒绝、取消或不可用——以及运行时上下文快照中的当前策略；审计事件与面向人类的权限 UI 不属于模型上下文。`never` 切换会以一条带来源的用户消息告知模型，两种策略都会把各自的完整当前含义贡献给快照。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

可观察行为已在[使用本包](#use-this-package)中说明；本节解释分发、策略执行与审计路径。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `ApprovalService`：请求分发、策略折叠与写入路径、运行时上下文贡献 |
| [`src/types.ts`](src/types.ts) | `ApprovalRequestId` brand 与结果类型 |

### 分发

`decide()` 让应答者 waterfall 与请求取消、服务卸载赛跑，并隔离应答者故障。应答者收到原有只读数据引用与组合信号，服务独立卸载也会撤回其提示。异常或未知回答以 `unavailable` 关闭。`never` 在授权复用与分发前检查，并在提交决定前再次检查。审计对指明操作所属轮次；持久化会保留物理上合法的中断历史，而授权恢复会排除经修复的轮次。

### 策略与运行时上下文快照

系统提示词贡献 `approval:policy` 在保留历史之后陈述有效策略的完整当前含义——`ask` 及其以拒绝方式关闭的后果，或 `never` 及其非升权后果——因此切换策略会追加一份新的完整快照，而不会改写稳定的请求头。`setPolicy()` 还会注入一条带来源的用户消息，为下一步宣布变更。

### 审计

`request()` 先追加携带请求身份与工具的 `approval/asked`，再追加携带最终结果的 `approval/decided`；确切追加字段见 [`src/index.ts`](src/index.ts)。两者都只写入日志。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从审批词汇逐步进入消费方与设计依据。

- [审批子系统参考](../../../docs/subsystems/approval.zh.md)——共享的请求／结果词汇与 `ctx.approval` 的 Cordis 接口面。
- [审批 seam Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-approval-seam.zh.md)——该 seam 的设计依据。
- [沙箱 参考](../../shell/tool-bash/README.zh.md)——沙箱 bash 工具如何为升权重试消费审批。
- [交互组映射](../README.zh.md)——相邻的权限预设与问答包。

-----

<a id="model-experience"></a>
## 模型体验

### 当前审批策略上下文

#### 模型看到的内容

首次请求与有效策略或授权变化时，都会在保留的历史后追加完整运行时上下文快照。没有可复用授权的会话保持以下策略文案。已授权 Session 说明复用仅限获准类别与目标范围；普通 `never` 仍确定拒绝，未分类强制确认仍须逐次决定。未变化的请求保留原快照，不增加另一条消息。

##### Ask 策略贡献

```markdown
Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.
```

##### Never 策略贡献

```markdown
Ordinary approval prompts are disabled in this session: actions that require ordinary approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`). Mandatory security confirmations, including deletion confirmation, still require the user to approve each action.
```

#### Token 影响

首次请求和策略实际变化时增加一条简洁的上下文消息；未变化的请求不增加重复的策略 token。

#### KV Cache 影响

在保留的历史之后仅追加。`ask`／`never` 切换会保留稳定的系统与对话前缀，而不会改写第一条 wire 消息。

### 工具结果

#### 模型看到的内容

`approval/asked` 和 `approval/decided` 只写入日志。模型只会看到发起请求的消费方最终给出的允许、拒绝、取消或不可用工具结果；面向人类的权限 UI 不属于上下文。

#### Token 影响

不会产生重复的审计 token。拒绝可能以一条简短且会保留的错误信息替换正常工具结果，而允许会保留消费方的普通结果。

#### KV Cache 影响

仅追加；新出现的可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该 seam 不适用的场景，以及组合时需要特别注意的场景。它们是当前包约束，不是通用权限对比。

- **请求只在尚未结束的轮次内有效**：在空闲时或轮次之间发起调用，会在审计前抛出异常；持久化的轮次外审批工作流仍属延期工作。
- **仅限同一会话**：授权只适用于同一 Session 中的可信操作类别和精确目标，不提供全局规则或逐条授权撤销；会话策略仍为 `ask`／`never`。
- **请求不携带工具参数**：应答者会看到工具名称、原因和可选调用 id；ACP（Agent Client Protocol）机器通道要求调用 id，并会委托不含 id 的请求。
- **没有内置应答者**：无头或组合不完整的部署会返回 `unavailable` 并以拒绝方式关闭；服务自身绝不会提示人类。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
