# Agent Note: 财务帐套编辑器移除报销设置

Status: implemented

[English](2026-09-07-finance-editor-without-reimbursement.md) | 中文

## Problem

当前产品工作仅针对财务，但财务帐套编辑器包含报销凭据。移除此入口不得清除独立保存的凭据或历史草稿。

## Decision

帐套弹窗不挂载报销设置组件，也不注入其读取、保存和测试操作。财务连接字段与独立的附件存储设置仍然可用。[保留的报销后端](2026-09-04-reimbursement-draft-attachments.zh.md)继续保存服务、凭据和回执；[Finance 权威能力清单](2026-09-15-finance-capability-inventory.zh.md)同时从当前 Finance 预设移除报销提示词、工具和 skill。

## Alternatives considered

**通过 CSS 隐藏区域。** 已挂载的隐藏区域仍可能读取配置并保留可调用操作。

**删除报销服务与数据。** 用户要求移除帐套配置字段，不是删除已保存记录或后端功能。

## Consequences

用户不能从帐套信息配置报销，也不能从当前 Finance 对话调用报销。历史记录和 Host 服务保持完整。组装 Web 编辑器回归检查报销字段和按钮不存在，同时验证财务保存、连接核验及响应式布局。无障碍快照记录实际展示的编辑器。
