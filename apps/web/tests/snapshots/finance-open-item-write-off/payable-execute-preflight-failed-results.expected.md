[
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-1",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<write-off-id>\",\"version\":1,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72621\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-09\",\"keeperName\":\"测试记账人\",\"sourceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72621\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"execution\":{\"state\":\"requires-confirmation\",\"cash\":{\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"currencyCodes\":[]},\"currencyCode\":\"RMB\"},\"period\":\"unverified\",\"reason\":\"确认前和发送前重新检查目标及资金科目；接口未提供期间锁定状态，不保证可记账或并发锁定。\"},\"notice\":\"仅保存整笔核销方案，没有核销、支付或收款。修改内容会生成新版本，旧版本不能继续确认。资金账户返回币种ID不等于已核实币种映射；不支持部分核销、反核销或自动关联操作。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-2",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72621\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"sourceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72621\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"execution\":{\"state\":\"requires-confirmation\",\"cash\":{\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"currencyCodes\":[]},\"currencyCode\":\"RMB\"},\"period\":\"unverified\",\"reason\":\"确认前和发送前重新检查目标及资金科目；接口未提供期间锁定状态，不保证可记账或并发锁定。\"},\"notice\":\"仅保存整笔核销方案，没有核销、支付或收款。修改内容会生成新版本，旧版本不能继续确认。资金账户返回币种ID不等于已核实币种映射；不支持部分核销、反核销或自动关联操作。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-3",
      "content": [
        {
          "type": "text",
          "text": "Error: 核销版本已变化或已有发送意图，不得重发。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-4",
      "content": [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的核销确认，没有发送。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-5",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"not-sent\",\"outcome\":{\"state\":\"not-sent\",\"reason\":\"preflight-failed\",\"preflightStage\":\"source-read\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72621\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"sourceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72621\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"readback\":{\"content\":\"matched\",\"settlement\":\"mismatch\",\"operation\":\"unverified\",\"businessAccount\":\"matched\"},\"execution\":{\"state\":\"recorded\",\"period\":\"unverified\"},\"notice\":\"核销发送结果已保存，不自动重发。accepted仅表示接口接收；业务账户、内容、余额和回执关联流水匹配才确认本次操作。结果未知或回查失败时只读检查原id；不代表银行实际收付款。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-6",
      "content": [
        {
          "type": "text",
          "text": "Error: 核销版本已变化或已有发送意图，不得重发。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "write-off-7",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<write-off-id>\",\"version\":2,\"phase\":\"not-sent\",\"outcome\":{\"state\":\"not-sent\",\"reason\":\"preflight-failed\",\"preflightStage\":\"source-read\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"核销演示账套\",\"direction\":\"payable\",\"openItemId\":\"72621\",\"cashAccountId\":\"174622\",\"amount\":\"0.19\",\"currencyCode\":\"RMB\",\"date\":\"2022-01-10\",\"keeperName\":\"测试记账人\",\"sourceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"target\":{\"amount\":\"0.19\",\"balance\":\"0.19\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"72621\",\"date\":\"2022-01-01\",\"summary\":\"整笔核销检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"businessAccountId\":\"174624\",\"cashAccount\":{\"id\":\"174622\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"directionRaw\":\"0\",\"currencyId\":\"1\"},\"effect\":\"记录整笔已收或已付，核销未结余额并可能生成资金流水；不发起银行收付款，不自动处理其他关联。\"},\"readback\":{\"content\":\"matched\",\"settlement\":\"mismatch\",\"operation\":\"unverified\",\"businessAccount\":\"matched\"},\"execution\":{\"state\":\"not-requested\"},\"notice\":\"只读核查原核销记录，没有发送或重发。预览和发送结果保持原版本；业务账户身份、内容、余额及回执关联流水分别核验，四项匹配才报告operation为matched。receiptId不是journalId；缺少原始身份或回执、关联缺失或重复、查询失败时不能确认操作。核验匹配不代表银行实际收付款，也不允许重发。\"}"
        }
      ],
      "isError": false
    }
  ]
]
