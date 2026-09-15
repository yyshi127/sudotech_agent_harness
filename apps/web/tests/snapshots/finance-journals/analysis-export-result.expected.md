{
  "report": {
    "accountId": "35601",
    "accountName": "日记账测试账套",
    "selection": {
      "cashAccountId": "174553",
      "current": {
        "month": "2026-09",
        "dateStart": "2026-09-01",
        "dateEnd": "2026-09-30"
      },
      "baseline": {
        "month": "2026-08",
        "dateStart": "2026-08-01",
        "dateEnd": "2026-08-31"
      }
    },
    "current": {
      "month": "2026-09",
      "dateStart": "2026-09-01",
      "dateEnd": "2026-09-30",
      "pagesRead": 2,
      "rows": [
        {
          "summary": "收入测试",
          "accountCode": "1001",
          "accountName": "库存现金",
          "currencyCode": "CNY",
          "baseCurrencyCode": "CNY",
          "income": "120.00",
          "expense": null,
          "balance": "120.00",
          "baseIncome": null,
          "baseExpense": null,
          "baseBalance": "0.00",
          "categoryName": "",
          "keeperName": "",
          "id": "123",
          "date": "2026-09-07"
        }
      ],
      "currencyCode": "CNY",
      "income": "120.00",
      "expense": "0.00",
      "incomeMissingValueCount": 0,
      "expenseMissingValueCount": 1
    },
    "baseline": {
      "month": "2026-08",
      "dateStart": "2026-08-01",
      "dateEnd": "2026-08-31",
      "pagesRead": 1,
      "rows": [],
      "currencyCode": null,
      "income": "0.00",
      "expense": "0.00",
      "incomeMissingValueCount": 0,
      "expenseMissingValueCount": 0
    },
    "differences": {
      "currencyCode": "CNY",
      "income": "120.00",
      "expense": "0.00"
    },
    "verificationOwner": "xiaojing",
    "coverage": "empty-page-and-totals-reconciled",
    "notice": "仅为指定出纳账户和日期的收支核对。verificationOwner=xiaojing：coverage 是小兢会计的本地核验标签，不是有成接口声明的完整性或原子快照保证。小兢会计逐页读取到空业务页，排除重复 ID，按业务行实际返回的同一原币核对已提供金额与接口收支合计。incomeMissingValueCount/expenseMissingValueCount 分别统计已返回流水中收入/支出金额未提供的单元格数，不是缺少流水记录，也不是漏查笔数；这些流水仍在 rows 中。空值仍为未提供，合计相符不证明每个空值为零；没有总数或原子快照保证，不称全账套完整数据。币种来自业务行，不补写汇总行币种；两组均为空时币种未知。差额为当前减基准的核对后收支金额，不计算期初期末余额，不与总账直接对账，不推断划转、审核或过账。"
  },
  "publishedXlsx": true,
  "hashMatchesBytes": true
}
