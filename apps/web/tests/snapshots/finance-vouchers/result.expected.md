[
  [
    {
      "type": "tool-result",
      "toolCallId": "voucher-query",
      "content": [
        {
          "type": "text",
          "text": "{\"accountId\":\"ledger-2\",\"accountName\":\"演示账套\",\"month\":\"2022-01\",\"monthEnd\":\"2022-03\",\"summary\":\"销售\",\"page\":1,\"pageSize\":2,\"total\":1,\"hasMore\":false,\"voucherCount\":1,\"notice\":\"total 为接口报告的本次筛选总张数，voucherCount 为本页张数，rows 为分录行；本页不是全部结果。month/monthEnd 按起止会计期间传给接口，日期为凭证日期，列表未返回独立会计期间，期间筛选未逐笔复核。summary 由接口筛选，精确或模糊匹配语义未核验；保留返回凭证的全部分录，不把未命中行删掉。翻页须保留筛选条件和 pageSize，期间数据可能变化。\",\"rows\":[{\"voucherId\":\"voucher-1\",\"date\":\"2022-01-01\",\"number\":\"记-1\",\"summary\":\"销售商品\",\"subjectCode\":\"1122\",\"subjectName\":\"应收账款\",\"debit\":\"30000.00\",\"credit\":\"0.00\"},{\"voucherId\":\"voucher-1\",\"date\":\"2022-01-01\",\"number\":\"记-1\",\"summary\":\"销售商品\",\"subjectCode\":\"5001\",\"subjectName\":\"主营业务收入\",\"debit\":\"0.00\",\"credit\":\"30000.00\"}]}"
        }
      ],
      "isError": false
    }
  ]
]
