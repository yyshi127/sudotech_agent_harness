---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-30-xiaojing-finance-rc2

[English](2026-09-30-xiaojing-finance-rc2.md) | 中文

## 概述

在 RC2 持久化清单中登记小兢已存在的五类 Finance 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-30-xiaojing-finance-rc2
baseline: false
changes:
  - root: "event:finance/client-bound"
    previous: null
    after: "4bceb77c2d8f71452bfc9e8553dc01a01b420db4448850559dfdebbb043871fc"
    decision: same-version
  - root: "event:finance/consultation-file-imported"
    previous: null
    after: "1f00f2e604e8825c99b6bfbc82639f853153632af1e782a1d3ef170ac0d3485a"
    decision: same-version
  - root: "event:finance/file-archived"
    previous: null
    after: "ced60f250857daa57c76493125bd680b1bf04515f68e78037e70c6f3bd644dd6"
    decision: same-version
  - root: "event:finance/file-imported"
    previous: null
    after: "2a6e99d971a77f4f026b78e3b999a131f5525f03b5f4b8ce2fff636672973b83"
    decision: same-version
  - root: "event:finance/file-published"
    previous: null
    after: "ba4b06e4dc224e5fbf89ef28483756fdd150d59a9557812251a291eae639c9c2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这些产品事件已存在于小兢集成中，字段与语义保持不变；相对官方 Harness 的确认历史，它们是新增事件根。不会改写或移除已提交的会话代际。读取 Finance 会话需要包含产品事件声明；纯官方构建不承诺读取这些产品专有事件。已有写入格式及头部迁移继续由已发布的 Harness 迁移链负责。

<a id="verification"></a>
## 验证

pnpm exec vitest run 选定小兢 Finance 包及相邻产品服务：122 个文件、2103 个测试通过。清单提取只报告上述五个新增根，没有 SessionHeader 版本变化。

<a id="dev-note"></a>
## 开发备注

无。
