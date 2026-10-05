---
kind: upgrade-guide
description: 自定义客户端布局提供方必须暴露当前导航的取消信号。
---

# 客户端布局导航信号

[English](guide.md) | 中文

## 变更

`ILayout` 现在要求只读的 `navigationSignal: AbortSignal` 属性。自定义布局提供方和完整的类型化 mock 必须提供它。标准 `LayoutController` 已自动提供该属性。启动消费方读取此信号，在工作区分类成员加载期间保留稍后的显式导航；读取本身不发起或取消导航。

## 迁移

1. 找到 `ILayout` 的实现及作为 `ctx.layout` 使用的完整 mock。参见[布局服务定义](../../../../packages/client/ui-layout/src/client/service.ts)。
2. 暴露 `beginNavigation()` 所使用的同一个取消控制器的信号。在导航改变前保持其引用不变。读取属性不能影响待完成的操作；下一次导航、有效的面板选择和布局释放仍须取消之前返回的信号。
3. 验证重复读取保留当前信号，开始导航会替换它并中止前一个信号，释放会中止当前信号。运行消费方 Client 程序的类型检查，确认每个完整实现都提供该属性。
