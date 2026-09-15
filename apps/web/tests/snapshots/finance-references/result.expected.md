[
  [
    {
      "type": "tool-result",
      "toolCallId": "reference-1",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ref-ledger\",\"accountName\":\"基础资料演示\",\"kind\":\"subjects\",\"requestedLimit\":1000,\"returnedCount\":2,\"coverage\":\"unverified\",\"selection\":\"ambiguous\",\"rows\":[{\"id\":\"6602\",\"code\":\"6602\",\"name\":\"费用\",\"status\":\"enabled\",\"parentCode\":\"\",\"subjectType\":\"期间费用\",\"hasChildren\":true,\"directionRaw\":\"0\"},{\"id\":\"660201\",\"code\":\"660201\",\"name\":\"费用\",\"status\":\"disabled\",\"parentCode\":\"6602\",\"hasChildren\":false}],\"notice\":\"接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。同名不猜选，未找到不自动新增；unknown 不代表启用。本次科目 directionRaw：0借1贷；未返回方向时不能根据名称或会计惯例推断。subjectType 是返回的科目类型名称；缺失或空白时不推断类型。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reference-2",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ref-ledger\",\"accountName\":\"基础资料演示\",\"kind\":\"auxiliary-categories\",\"requestedLimit\":1000,\"returnedCount\":1,\"coverage\":\"unverified\",\"selection\":\"not-requested\",\"rows\":[{\"id\":\"cat\",\"code\":\"01\",\"name\":\"客户\",\"status\":\"unknown\"}],\"notice\":\"接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。同名不猜选，未找到不自动新增；unknown 不代表启用。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reference-3",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ref-ledger\",\"accountName\":\"基础资料演示\",\"kind\":\"auxiliary-items\",\"categoryCode\":\"01\",\"requestedLimit\":1000,\"returnedCount\":1,\"coverage\":\"unverified\",\"selection\":\"not-requested\",\"rows\":[{\"id\":\"item\",\"code\":\"001\",\"name\":\"客户甲\",\"status\":\"unknown\"}],\"notice\":\"接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。同名不猜选，未找到不自动新增；unknown 不代表启用。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reference-4",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ref-ledger\",\"accountName\":\"基础资料演示\",\"kind\":\"cash-accounts\",\"requestedLimit\":1000,\"returnedCount\":1,\"coverage\":\"unverified\",\"selection\":\"not-requested\",\"rows\":[{\"id\":\"11\",\"code\":\"1002\",\"name\":\"银行\",\"status\":\"enabled\",\"directionRaw\":\"0\"}],\"notice\":\"接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。同名不猜选，未找到不自动新增；unknown 不代表启用。本次出纳账户 directionRaw：0借1贷。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reference-5",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ref-ledger\",\"accountName\":\"基础资料演示\",\"kind\":\"cash-categories\",\"requestedLimit\":1000,\"returnedCount\":1,\"coverage\":\"unverified\",\"selection\":\"not-requested\",\"rows\":[{\"id\":\"21\",\"code\":\"01\",\"name\":\"销售收入\",\"status\":\"unknown\",\"directionRaw\":\"0\"}],\"notice\":\"接口未提供总数或翻页游标，完整性未验证；筛选仅针对本次返回。同名不猜选，未找到不自动新增；unknown 不代表启用。本次收支类别 directionRaw：0收1支。\"}"
        }
      ],
      "isError": false
    }
  ]
]
