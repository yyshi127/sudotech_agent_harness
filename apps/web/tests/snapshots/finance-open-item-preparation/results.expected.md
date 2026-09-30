[
  {
    "scenario": "receivable",
    "writes": 1,
    "results": [
      [
        {
          "type": "text",
          "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1},\"source\":\"existing-open-item-page\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
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
          "type": "text",
          "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1},\"source\":\"existing-open-item-page\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174624\",\"accountName\":\"应付账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578260\",\"categoryName\":\"其他支出\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"供应商:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174624\",\"accountName\":\"应付账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578260\",\"categoryName\":\"其他支出\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"供应商:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174624\",\"name\":\"应付账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"payable\",\"accountId\":\"174624\",\"categoryId\":\"578260\",\"auxiliaryCategoryCode\":\"02\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"payable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"outcome\":{\"state\":\"accepted\",\"openItemId\":\"72595\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"balance\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
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
          "type": "text",
          "text": "{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"query\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1},\"source\":\"existing-open-item-page\",\"observations\":[{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.05\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"references\":{\"ledgerId\":\"35616\",\"ledgerName\":\"往来演示账套\",\"accountId\":\"174626\",\"accountName\":\"应收账款\",\"currencyCode\":\"RMB\",\"categoryId\":\"578250\",\"categoryName\":\"其他收入\",\"counterparty\":{\"categoryId\":\"101\",\"categoryCode\":\"01\",\"categoryName\":\"客户\",\"itemId\":\"191501\",\"itemCode\":\"03\",\"itemName\":\"往来测试\",\"itemStatus\":\"unknown\",\"wireName\":\"客户:往来测试\"}},\"accountObservation\":{\"sourceRecordId\":\"70000\",\"id\":\"174626\",\"name\":\"应收账款\",\"status\":\"enabled\",\"foreignCurrency\":false,\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送往来。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"balance\":\"unavailable\",\"complete\":false},\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"35616\",\"name\":\"往来演示账套\"},\"input\":{\"direction\":\"receivable\",\"accountId\":\"174626\",\"categoryId\":\"578250\",\"auxiliaryCategoryCode\":\"01\",\"auxiliaryItemId\":\"191501\",\"date\":\"2022-01-09\",\"amount\":\"0.06\",\"summary\":\"往来闭环测试\",\"keeperName\":\"测试员\",\"accountReferenceQuery\":{\"direction\":\"receivable\",\"periodStart\":\"2022-01\",\"periodEnd\":\"2022-01\",\"page\":1}},\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"balance\":\"unavailable\",\"complete\":false},\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 往来版本已变化或已有发送记录，请查看原记录。"
        }
      ]
    ]
  }
]
