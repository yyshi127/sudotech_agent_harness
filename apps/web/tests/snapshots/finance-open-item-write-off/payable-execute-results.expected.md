[
  [
    {
      "type": "text",
      "text": "{\"id\":\"<write-off-id>\",\"version\":1,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72613\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-09\",\"keeperName\":\"测试记账人\",\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72613\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"execution\":{\"state\":\"requires-confirmation\",\"cash\":{\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"currencyCodes\":[]},\"currencyCode\":\"RMB\"},\"period\":\"unverified\",\"reason\":\"确认前和发送前重新检查目标及资金科目；接口未提供期间锁定状态，不保证可记账或并发锁定。\"}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72613\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72613\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"execution\":{\"state\":\"requires-confirmation\",\"cash\":{\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"currencyCodes\":[]},\"currencyCode\":\"RMB\"},\"period\":\"unverified\",\"reason\":\"确认前和发送前重新检查目标及资金科目；接口未提供期间锁定状态，不保证可记账或并发锁定。\"}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 核销版本已变化或已有发送意图，不得重发。"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 未获得本次准确版本的核销确认，没有发送。"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"receiptId\":\"65834\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72613\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72613\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"readback\":{\"content\":\"matched\",\"settlement\":\"matched\",\"operation\":\"matched\",\"businessAccount\":\"matched\",\"journalLink\":{\"state\":\"matched\",\"receiptId\":\"65834\",\"journalId\":\"141109\"}},\"execution\":{\"state\":\"recorded\",\"period\":\"unverified\"}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 核销版本已变化或已有发送意图，不得重发。"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"receiptId\":\"65834\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72613\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72613\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"readback\":{\"content\":\"matched\",\"settlement\":\"matched\",\"operation\":\"matched\",\"businessAccount\":\"matched\",\"journalLink\":{\"state\":\"matched\",\"receiptId\":\"65834\",\"journalId\":\"141109\"}},\"execution\":{\"state\":\"not-requested\"}}"
    }
  ]
]
