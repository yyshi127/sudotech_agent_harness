[
  [
    {
      "type": "tool-result",
      "toolCallId": "balance-query",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"35601\",\"accountName\":\"余额测试账套\",\"month\":\"2026-09\",\"monthEnd\":\"2026-09\",\"rows\":[],\"summaries\":[],\"coverage\":\"unverified\",\"notice\":\"金额保留接口借贷列及正负号，借贷不统一解释为进出或增减；Balance 只称接口余额。null 在科目行和汇总行均写“未提供”，不能写零或“无（空）”。发生额留空只能说明未提供，不能称“本期无发生”；期初期末相等也不能证明期间没有发生。不从金额相同推断划转，不自行展开算式。科目行可能含父子层级，小计和合计单独列出，禁止将这些行重复加总。接口 count 不能证明数据完整；没有科目行不代表账套无余额或无异常。未执行任何写操作。\"}"
        }
      ],
      "isError": false
    }
  ]
]
