[
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-1",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":1,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"流水删除演示账套\",\"cashAccountId\":\"174622\",\"row\":{\"summary\":\"删除专用测试\",\"accountCode\":\"\",\"accountName\":\"库存现金\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"income\":\"0.01\",\"expense\":null,\"balance\":\"0.01\",\"baseIncome\":\"0.01\",\"baseExpense\":null,\"baseBalance\":\"0.01\",\"categoryName\":\"收-其他收入\",\"keeperName\":\"测试\",\"id\":\"123\",\"date\":\"2022-01-01\"},\"fingerprint\":\"78ea06227cbf4d91d170528d2ee357ce03e089508649104cd8406a2470815eef\",\"reviewStatus\":0,\"channel\":\"ADD\",\"attachmentCount\":0,\"blockers\":[]},\"selection\":{\"month\":\"2022-01\",\"cashAccountId\":\"174622\"},\"baselineCount\":1,\"notice\":\"仅准备删除指定流水的预览，尚未发送。删除影响该资金账户的记录和余额，不联动删除凭证或往来，不执行实际收付款，不提供自动撤销；必须确认准确版本。回查仅覆盖原账户、原月份。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-2",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":{\"accountId\":\"35616\",\"accountName\":\"流水删除演示账套\",\"cashAccountId\":\"174622\",\"row\":{\"summary\":\"删除专用测试\",\"accountCode\":\"\",\"accountName\":\"库存现金\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"income\":\"0.01\",\"expense\":null,\"balance\":\"0.01\",\"baseIncome\":\"0.01\",\"baseExpense\":null,\"baseBalance\":\"0.01\",\"categoryName\":\"收-其他收入\",\"keeperName\":\"测试\",\"id\":\"123\",\"date\":\"2022-01-01\"},\"fingerprint\":\"78ea06227cbf4d91d170528d2ee357ce03e089508649104cd8406a2470815eef\",\"reviewStatus\":0,\"channel\":\"ADD\",\"attachmentCount\":0,\"blockers\":[]},\"selection\":{\"month\":\"2022-01\",\"cashAccountId\":\"174622\"},\"baselineCount\":1,\"notice\":\"仅准备删除指定流水的预览，尚未发送。删除影响该资金账户的记录和余额，不联动删除凭证或往来，不执行实际收付款，不提供自动撤销；必须确认准确版本。回查仅覆盖原账户、原月份。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-3",
      "content": [
        {
          "type": "text",
          "text": "Error: 日记账删除版本已变化或存在发送记录，不得重发。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-4",
      "content": [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的日记账删除确认，没有发送。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-5",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"流水删除演示账套\",\"cashAccountId\":\"174622\",\"row\":{\"summary\":\"删除专用测试\",\"accountCode\":\"\",\"accountName\":\"库存现金\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"income\":\"0.01\",\"expense\":null,\"balance\":\"0.01\",\"baseIncome\":\"0.01\",\"baseExpense\":null,\"baseBalance\":\"0.01\",\"categoryName\":\"收-其他收入\",\"keeperName\":\"测试\",\"id\":\"123\",\"date\":\"2022-01-01\"},\"fingerprint\":\"78ea06227cbf4d91d170528d2ee357ce03e089508649104cd8406a2470815eef\",\"reviewStatus\":0,\"channel\":\"ADD\",\"attachmentCount\":0,\"blockers\":[]},\"selection\":{\"month\":\"2022-01\",\"cashAccountId\":\"174622\"},\"readback\":{\"target\":\"not-observed\",\"content\":\"matched\",\"balances\":\"matched\",\"scope\":\"selected-month\"},\"notice\":\"删除发送结果已保存，不自动重发。accepted 不是核验结论；not-observed 仅限原月份和账户，不是全账套删除证明。余额与剩余流水核验分别以 readback 为准，查询失败不表示不存在。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-6",
      "content": [
        {
          "type": "text",
          "text": "Error: 日记账删除版本已变化或存在发送记录，不得重发。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "journal-deletion-7",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"preview\":{\"accountId\":\"35616\",\"accountName\":\"流水删除演示账套\",\"cashAccountId\":\"174622\",\"row\":{\"summary\":\"删除专用测试\",\"accountCode\":\"\",\"accountName\":\"库存现金\",\"currencyCode\":\"RMB\",\"baseCurrencyCode\":\"RMB\",\"income\":\"0.01\",\"expense\":null,\"balance\":\"0.01\",\"baseIncome\":\"0.01\",\"baseExpense\":null,\"baseBalance\":\"0.01\",\"categoryName\":\"收-其他收入\",\"keeperName\":\"测试\",\"id\":\"123\",\"date\":\"2022-01-01\"},\"fingerprint\":\"78ea06227cbf4d91d170528d2ee357ce03e089508649104cd8406a2470815eef\",\"reviewStatus\":0,\"channel\":\"ADD\",\"attachmentCount\":0,\"blockers\":[]},\"selection\":{\"month\":\"2022-01\",\"cashAccountId\":\"174622\"},\"readback\":{\"target\":\"not-observed\",\"content\":\"matched\",\"balances\":\"matched\",\"scope\":\"selected-month\"},\"notice\":\"仅只读检查原记录，不重发。not-observed 仅表示原月份、原账户两次完整查询未返回目标，不证明全账套不存在；余额和剩余流水内容分别核验。\"}"
        }
      ],
      "isError": false
    }
  ]
]
