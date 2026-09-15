# 有成 V2 财务应收／应付接口核验记录

核验范围：生产服务上的授权测试账套「瑞华云／施的演示账套」，账套 ID35616。日期2026-09-09；不涉及报销模块。此记录不含密钥，尚未发送给有成。

## 需要确认的两点

1. `POST /finance/cashier/account/management/add.rjson` 的 `auxiliaryItemNames` 应如何填写、放在请求的什么位置？请给一份能成功新增的最小请求示例，说明应收与应付的往来对象是否有不同要求。当前传真实客户名称仍返回201「未指定往来单位」。
2. `/finance/cashjournal/getAccountList.rjson` 如何取得应收、应付账户？同一账套网页显示5个已启用账户，接口只返回其中3个资金账户。文档响应类型列出5应收款、6应付款，但请求仅列sobName／setOfBooksId／pageSize，未说明其他筛选参数。

## 已确认的请求与结果

[官方财务文档](https://yiqbopenapi.superboss.cc/#/share/awXPk8nW) 中新增接口文档ID为B2llxm2D，账户列表为q2REAOzg。新增文档的修改时间为2025-04-22 14:08:58；本轮在线重查的路径、请求参数、Content-Type和说明与已保存版本一致。

最初按文档发送以下JSON，认证信息仅在URL中传入，此处省略：

```json
{
  "booksName": "施的演示账套",
  "categoryName": "其他收入",
  "auxiliaryItemNames": "淘云科技",
  "direction": false,
  "date": "2022-01-01",
  "abstractStr": "小兢F3A-35616-20260909-AR-PROBE-01",
  "money": 0.03,
  "resource": 1,
  "keeperName": "小兢测试"
}
```

账户ID174626在网页中为启用的「应收账款」，关联科目112201；客户类别01下编码03／名称淘云科技的接口ID为191501。网页与读取接口均核对了客户身份，没有为解决报错另建客户。

后续独立实验仅在前次明确拒绝、对应期间回查为空后进行。已分别检查补充账户ID、原字段同时放URL、补网页使用的auxiliaryItemIds／auxiliaryItemName、补accountName，以及将keeperName改成有成成员「施」。上述均明确拒绝。

最后一项组合实验保留此前请求内容不变，将相同字段同时置于URL和JSON，以检查尚未覆盖的参数接收方式。它额外使用以下字段，不能当作文档已确认的公共接口字段：

```json
{
  "accountId": 174626,
  "auxiliaryItemIds": "191501",
  "auxiliaryItemName": "淘云科技",
  "accountName": "施的演示账套",
  "keeperName": "施"
}
```

最终HTTP200，Content-Type为text/html;charset=UTF-8，实际业务响应：

```json
{"message":"未指定往来单位","result":201}
```

因此不能归结为HTTP连接失败，也不能声称已定位供应商程序缺陷。字段格式、接收位置及账户解析仍未得到成功请求证明。没有请求其他写接口，没有以网页私有保存接口替代公共接口。

## 账户查询差异

使用同一账套ID／名称和pageSize1000，公共接口返回174622库存现金、174625银行存款、174623其他货币资金；未返回网页显示的174626应收账款和174624应付账款。网页五个账户均启用。接口未返回总数或游标，因此不声称账户被删除、未配置或读取完整。

## 结果与复查入口

最终实验发送前与发送后，2022-01期间应收0条、应付0条；原41张凭证ID集合保留。应收网页已选2022年第01期，记录与余额均为0。以上不能证明其他期间全量为空。

- [最终发送意图](receipts/open-item-probe/query-counterparty-attempt-1/intent.json)、[实际响应](receipts/open-item-probe/query-counterparty-attempt-1/http-response.json)、[独立回查](receipts/open-item-probe/query-counterparty-attempt-1/readback-1788954465281.json)。
- [公共账户查询](receipts/open-item-probe/query-counterparty-attempt-1/fresh-account-reference.json)、[当前网页账户记录](receipts/open-item-probe/account-ui-recheck-20260909.json)。
- [独立脚本](qualify-open-item.mjs) 不带参数仅回查；`--inspect-accounts`只读账户与业务基线。所有写入参数均已使用，不应再次执行，尤其不要重复`--qualify-query-counterparty`。

组合实验曾两次在发送前被本地检查拦住：第一次是实验读取白名单缺少已存在的账户查询地址；第二次是公共接口未返回应收账户。两次均没有发送意图或发送记录，也没有新增请求。最后一次在重新核对当前网页账户后才发送一次；不能将此前两个本地失败计入供应商新增接口失败次数。
