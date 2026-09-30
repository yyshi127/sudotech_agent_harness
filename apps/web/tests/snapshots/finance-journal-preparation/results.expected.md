[
  {
    "scenario": "income",
    "direction": "income",
    "writes": 1,
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.11\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"journalId\":\"141053\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"outcome\":{\"state\":\"accepted\",\"journalId\":\"141053\"},\"readback\":{\"content\":\"matched\",\"associations\":\"matched\",\"complete\":true},\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
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
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.07\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他支出\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.08\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他支出\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"complete\":false},\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"expense\",\"amount\":\"0.08\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578260\"},\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"unavailable\",\"associations\":\"unavailable\",\"complete\":false},\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
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
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.11\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120455\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账版本已变化或已有发送记录，请查看原记录。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的确认，没有发送日记账。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 日记账资料或新增位置已变化，请重新预览确认。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"日记账演示账套\"},\"input\":{\"cashAccountId\":\"174622\",\"date\":\"2022-01-01\",\"direction\":\"income\",\"amount\":\"0.12\",\"summary\":\"日记账闭环测试\",\"keeperName\":\"小兢测试\",\"categoryId\":\"578250\"},\"references\":{\"accountId\":\"35616\",\"accountName\":\"日记账演示账套\",\"cashAccountId\":\"174622\",\"cashAccountName\":\"库存现金\",\"cashAccountCode\":\"1001\",\"cashAccountCurrencyId\":\"120456\",\"cashAccountType\":1,\"cashAccountDirectionRaw\":\"0\",\"categoryName\":\"其他收入\"},\"position\":{\"previousId\":\"0\",\"basis\":\"first-position\"}}"
        }
      ]
    ]
  }
]
