# Agent Note: 打开已提交的财务成果

Status: implemented

[English](2026-09-07-finance-published-file-opening.md) | 中文

## Problem

财务导出目标路径在发布后确定，调用前的文件位置无法标识它。即使模型写出正确路径，成功导出的文件仍可能只是纯文本。

## Decision

财务客户端插件将已有的每条 `finance/file-published` 事件投影为独立聊天节点。按钮使用已提交的名称和确切路径，调用现有 Host 文件打开功能；只有用户点击才打开文件，非回环客户端显示禁用操作。导入、归档、导出失败和助手文本均不生成该节点。[包说明](../../../../packages/client/ui-xiaojing-finance-clients/README.zh.md)负责用户可见行为。

## Alternatives considered

模型编写链接无法保证交付。扩展通用工具结果展示会影响无关工具；持久化财务事件已提供所需证据，无需更改协议。

## Consequences

历史回放可恢复文件操作，不重复导出或改变模型上下文。该操作打开本地文件，不是浏览器下载；文件缺失或没有电子表格程序仍属于 Host 打开失败。组件检查覆盖确切路径点击和远程禁用，组合导出检查覆盖实际发布及页面重载。业务查询准确性和工作簿内容仍需独立核验。
