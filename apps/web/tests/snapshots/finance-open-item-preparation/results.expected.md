[
  {
    "scenario": "receivable",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-1",
          "content": [
            {
              "type": "text",
              "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"source\":\"existing-open-item-page\",\"coverage\":\"returned-page-only\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-3",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-5",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"往来发送结果已保存，不会自动重发。complete仅表示本记录技术核验，不表示实际收付款或核销。结果未知或回查未完成时查看原记录，不另建同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-7",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"只读核验原往来，不重发。complete仅表示记录内容、关联及初始余额的技术比较，不表示实际收付款或核销。未找到或无法核验不等于未创建；未知结果不得通过另建相同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-8",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "scenario": "payable",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-1",
          "content": [
            {
              "type": "text",
              "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"source\":\"existing-open-item-page\",\"coverage\":\"returned-page-only\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174624\",\"accountName\":\"应付账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578260\",\"categoryName\":\"其他支出\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"供应商:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-3",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174624\",\"accountName\":\"应付账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578260\",\"categoryName\":\"其他支出\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"供应商:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-5",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"往来发送结果已保存，不会自动重发。complete仅表示本记录技术核验，不表示实际收付款或核销。结果未知或回查未完成时查看原记录，不另建同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-7",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"只读核验原往来，不重发。complete仅表示记录内容、关联及初始余额的技术比较，不表示实际收付款或核销。未找到或无法核验不等于未创建；未知结果不得通过另建相同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-8",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "scenario": "lost",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-1",
          "content": [
            {
              "type": "text",
              "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100},\"source\":\"existing-open-item-page\",\"coverage\":\"returned-page-only\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-3",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"},\"notice\":\"仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-5",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"balance\":\"unavailable\",\"complete\":false},\"complete\":false,\"notice\":\"往来发送结果已保存，不会自动重发。complete仅表示本记录技术核验，不表示实际收付款或核销。结果未知或回查未完成时查看原记录，不另建同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-7",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1,\"pageSize\":100}},\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"balance\":\"unavailable\",\"complete\":false},\"complete\":false,\"notice\":\"只读核验原往来，不重发。complete仅表示记录内容、关联及初始余额的技术比较，不表示实际收付款或核销。未找到或无法核验不等于未创建；未知结果不得通过另建相同内容重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "open-item-8",
          "content": [
            {
              "type": "text",
              "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  }
]
