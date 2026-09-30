[
  [
    {
      "type": "text",
      "text": "{\"id\":\"<deletion-id>\",\"version\":1,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"往来删除演示账套\",\"direction\":\"payable\",\"businessAccountId\":\"174624\",\"row\":{\"amount\":\"0.01\",\"balance\":\"0.01\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"82619\",\"date\":\"2022-01-01\",\"summary\":\"删除检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"attachmentCount\":0,\"blockers\":[],\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]},\"selection\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\"},\"baselineCount\":2,\"execution\":{\"state\":\"requires-confirmation\",\"reason\":\"确认前和发送前重查目标；公开接口无法完整排除有成提示的关联记录连带删除影响。\",\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"往来删除演示账套\",\"direction\":\"payable\",\"businessAccountId\":\"174624\",\"row\":{\"amount\":\"0.01\",\"balance\":\"0.01\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"82619\",\"date\":\"2022-01-01\",\"summary\":\"删除检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"attachmentCount\":0,\"blockers\":[],\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]},\"selection\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\"},\"baselineCount\":2,\"execution\":{\"state\":\"requires-confirmation\",\"reason\":\"确认前和发送前重查目标；公开接口无法完整排除有成提示的关联记录连带删除影响。\",\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 应收应付删除版本已变化或存在发送记录，不得重发。"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 未获得本次准确版本的应收应付删除确认，没有发送。"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"往来删除演示账套\",\"direction\":\"payable\",\"businessAccountId\":\"174624\",\"row\":{\"amount\":\"0.01\",\"balance\":\"0.01\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"82619\",\"date\":\"2022-01-01\",\"summary\":\"删除检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"attachmentCount\":0,\"blockers\":[],\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]},\"selection\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\"},\"readback\":{\"target\":\"not-observed\",\"scope\":\"selected-direction-periods\",\"content\":\"matched\",\"remainingBalances\":\"mismatch\",\"balances\":{\"original\":{\"state\":\"mismatch\",\"remaining\":\"mismatch\",\"changes\":[{\"currencyCode\":\"RMB\",\"before\":\"0.20\",\"after\":\"0.18\",\"removed\":\"0.01\",\"expectedAfter\":\"0.19\",\"state\":\"mismatch\",\"basis\":\"reported\"}]},\"base\":{\"state\":\"mismatch\",\"remaining\":\"mismatch\",\"changes\":[{\"currencyCode\":\"RMB\",\"before\":\"0.20\",\"after\":\"0.18\",\"removed\":\"0.01\",\"expectedAfter\":\"0.19\",\"state\":\"mismatch\",\"basis\":\"same-currency\"}]}}},\"execution\":{\"state\":\"recorded\"}}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 应收应付删除版本已变化或存在发送记录，不得重发。"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"往来删除演示账套\",\"direction\":\"payable\",\"businessAccountId\":\"174624\",\"row\":{\"amount\":\"0.01\",\"balance\":\"0.01\",\"baseAmount\":null,\"baseBalance\":null,\"settledAmount\":\"0.00\",\"badDebtAmount\":\"0.00\",\"offsetAmount\":\"0.00\",\"returnAmount\":\"0.00\",\"id\":\"82619\",\"date\":\"2022-01-01\",\"summary\":\"删除检查专用\",\"subjectCode\":\"\",\"subjectName\":\"往来账户\",\"auxiliaryItemIds\":\"191501\",\"auxiliaryItemName\":\"测试往来单位\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"initialBalance\":false,\"finished\":false,\"categoryName\":\"其他收支\",\"remark\":\"\"},\"attachmentCount\":0,\"blockers\":[],\"unverified\":[\"查询方向由原请求限定；列表未独立提供方向字段。\",\"审核状态和记录来源字段未提供，不能据此认定无审批或外部来源限制。\",\"有成网页提示删除可能连带删除对冲、核销或收入记录；公开接口的完整关联影响未核实，本检查不能排除该影响。\"]},\"selection\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\"},\"readback\":{\"target\":\"not-observed\",\"scope\":\"selected-direction-periods\",\"content\":\"matched\",\"remainingBalances\":\"mismatch\",\"balances\":{\"original\":{\"state\":\"mismatch\",\"remaining\":\"mismatch\",\"changes\":[{\"currencyCode\":\"RMB\",\"before\":\"0.20\",\"after\":\"0.18\",\"removed\":\"0.01\",\"expectedAfter\":\"0.19\",\"state\":\"mismatch\",\"basis\":\"reported\"}]},\"base\":{\"state\":\"mismatch\",\"remaining\":\"mismatch\",\"changes\":[{\"currencyCode\":\"RMB\",\"before\":\"0.20\",\"after\":\"0.18\",\"removed\":\"0.01\",\"expectedAfter\":\"0.19\",\"state\":\"mismatch\",\"basis\":\"same-currency\"}]}}},\"execution\":{\"state\":\"not-requested\"}}"
    }
  ]
]
