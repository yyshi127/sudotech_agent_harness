---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-03-session-operation-authorization

[English](2026-10-03-session-operation-authorization.md) | 中文

## 概述

为审批问题与决定增加可选可信操作分类和同会话授权审计字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-session-operation-authorization
baseline: false
changes:
  - root: "event:approval/asked"
    previous: "2026-09-11-initial"
    after: "d53791005c8503dd7c37fccfafb06b9213270c0660621b87f70e2f97f17792da"
    decision: same-version
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "53b59363ea6c46bb0ef4b01b02f15eed3c26187c9c13015c2aa867131311d730"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有审批记录和 ApprovalOutcome 原有四种结果保持不变；可选字段缺失不产生可复用授权。创建和复用仅适用于同一 Session id 及精确类别和范围。当前对象仅在决定追加提交后复用；重启只恢复原本已关闭轮次的授权，排除 interrupted/forked 修复关闭。合法中断历史仍可读取，但不产生授权。已发布校验器和 Session 写入版本保持不变。

<a id="verification"></a>
## 验证

Node 24 执行 node_modules/vitest/vitest.mjs run packages/interaction/user-approval/tests packages/acp/acp/tests/approval.spec.ts，四个文件共 65 项通过。真实 Loader/Agent 测试覆盖取消、迟答、卸载、审计提交失败、同类并发、新会话隔离，以及真实生产 JSONL/Zstandard 持久化与 AgentRegistry.resume 的闭合授权恢复和中断尾部拒绝。

<a id="dev-note"></a>
## 开发备注

无。
