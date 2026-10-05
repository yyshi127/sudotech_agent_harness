---
kind: upgrade-guide
description: "审批应答者使用 ApprovalAnswer 表达新增同会话授权，操作消费方仍使用 ApprovalOutcome。"
---

# 同会话审批回答

[English](guide.md) | 中文

## 变更

`approval/request` waterfall 使用 `ApprovalAnswer`，在原有四种回答之外增加 `allowed-session`；`next()` 同样返回 `ApprovalAnswer`。`ctx.approval.request()` 与 `requestMandatory()` 的消费方仍收到原有 `ApprovalOutcome`；服务将会话授权规范化为 `allowed-once`，并在可选审计字段中记录范围。未分类请求不能创建会话授权。

应答者收到请求投影，其 `signal` 组合调用方取消与服务卸载。Agent 及只读数据引用保持不变，但不再保持请求对象本身的身份。卸载服务会撤回待答提示并取消决定。

ACP 只为可信已分类请求公布 `allow-session` 选项，类型为 `allow_always`。授权仅适用于当前 Session 的操作类别和精确目标范围；原本已关闭轮次的授权可在重启后恢复，始终不会成为全局规则。

## 迁移

1. 显式声明 waterfall 返回类型或 `next()` 类型的应答者应从 `@deepseek-ai/dsh-user-approval/types` 导入 `ApprovalAnswer`。操作消费方保留 `ApprovalOutcome`。
2. 监听收到的 `signal` 以撤回提示；通过 `agent` 和 `callId` 识别所属操作，不依赖请求对象相等。
3. 仅在请求包含 `reusable` 时提供 `allowed-session`。可信请求方代码提供 `category`、精确 `scope` 和说明性 `label`，禁止直接从模型参数接收这些字段。
4. ACP 客户端将公布的 `allow-session` 解释为只限当前 Session 的授权。未知或未公布选项仍拒绝。
5. 确认匹配请求复用授权、不同范围仍询问、新 Session 重新询问。现有未分类调用方无需修改。
