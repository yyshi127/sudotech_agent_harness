# Agent Note: 财务帐套编辑器移除报销设置

Status: implemented

[English](2026-09-07-finance-editor-without-reimbursement.md) | 中文

## Problem

当前产品工作仅针对财务，但财务帐套编辑器包含报销凭据。移除此入口不得清除独立保存的凭据或历史草稿。

## Decision

帐套弹窗不挂载报销设置组件，也不注入其读取、保存和测试操作。财务连接字段与独立的附件存储设置仍然可用。[既有报销能力](2026-09-04-reimbursement-draft-attachments.zh.md)保留后端服务、凭据与回执；这项界面修改不代表完整业务隔离。

## Alternatives considered

**通过 CSS 隐藏区域。** 已挂载的隐藏区域仍可能读取配置并保留可调用操作。

**删除报销服务与数据。** 用户要求移除帐套配置字段，不是删除已保存记录或后端功能。

## Consequences

用户不能从帐套信息配置报销。组装 Web 编辑器回归检查报销字段和按钮不存在，同时验证财务保存、连接核验及响应式布局。无障碍快照记录实际展示的编辑器。
