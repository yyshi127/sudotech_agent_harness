[
  {
    "scenario": "income",
    "direction": "income",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "income-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.11\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"journalId\":\"141053\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"已保存日记账发送结果，不会自动重发。complete仅表示本记录技术核验，不证明实际收付款；本工具未调用凭证生成或审核接口。回查失败或结果未知时查看原记录，不重新准备相同记录。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"outcome\":{\"state\":\"accepted\",\"journalId\":\"141053\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"complete\":true},\"complete\":true,\"notice\":\"只读核验原日记账，不重发。complete仅表示记录内容及返回关联的技术比较，不证明实际收付款。未找到或无法核验不等于未创建；结果未知须核实原操作，不得新建同内容记录重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "scenario": "expense",
    "direction": "expense",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.07\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他支出\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.08\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他支出\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"complete\":false},\"complete\":false,\"notice\":\"已保存日记账发送结果，不会自动重发。complete仅表示本记录技术核验，不证明实际收付款；本工具未调用凭证生成或审核接口。回查失败或结果未知时查看原记录，不重新准备相同记录。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.08\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"complete\":false},\"complete\":false,\"notice\":\"只读核验原日记账，不重发。complete仅表示记录内容及返回关联的技术比较，不证明实际收付款。未找到或无法核验不等于未创建；结果未知须核实原操作，不得新建同内容记录重试。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "expense-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "scenario": "currency-change",
    "direction": "income",
    "writes": 0,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "income-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.11\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-5",
          "content": [
            {
              "type": "text",
              "text": "Error: 日记账资料或新增位置已变化，请重新预览确认。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "income-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120456\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\",\"coverage\":\"unverified\"},\"notice\":\"仅本地日记账预览，未写入有成，也未生成凭证或实际收付款。金额按所选资金账户币别记录，不根据币种ID猜币种。新增位置为所示已有记录之后；没有返回记录时使用首位，不宣称查询覆盖全部历史。可写日期仍由有成提交校验。创建前必须确认准确版本；不附加审核、凭证、附件、核销或往来关联。\"}"
            }
          ],
          "isError": false
        }
      ]
    ]
  }
]
