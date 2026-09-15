# 有成 OPENAPI 来源快照

[English](youcheng-openapi-replica.md) | 中文

## 范围与来源

[结构化快照](youcheng-openapi-replica.json)和[可读原文提取文件](youcheng-openapi-replica.source.txt)保存共享目录 `7YX0lXxR` 的供应商文档。提取文件记录抓取时间、来源 URL、文档标识和失败情况。它包含偏报销的接口目录，不是独立的 V2 财务目录；两者区别见[能力映射](youcheng-capability-implementation-matrix.zh.md)。保存的示例不能证明接口可用，也不能证明产品操作成功。

## 维护

[镜像脚本](../../scripts/replicate-youcheng-openapi.mjs)读取供应商文档服务，仅替换 JSON 快照和原文提取文件，不执行业务请求。提取文件以来源数据的形式保留生成器的类 Markdown 格式，不是项目维护的英文参考文档，也不是经过审阅的翻译。本双语页面负责说明其范围和维护方式，不会被脚本覆盖。
