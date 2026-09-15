{
  "report": {
    "accountId": "35601",
    "accountName": "应收应付测试账套",
    "selection": {
      "direction": "receivable",
      "periodStart": "2026-09",
      "periodEnd": "2026-09",
      "page": 1,
      "pageSize": 20
    },
    "totalCount": 1,
    "rows": [
      {
        "amount": "300.00",
        "balance": "200.00",
        "baseAmount": "0.00",
        "baseBalance": "0.00",
        "settledAmount": "100.00",
        "badDebtAmount": null,
        "offsetAmount": null,
        "returnAmount": null,
        "id": "123",
        "date": "2026-09-07",
        "summary": "往来测试",
        "subjectCode": "1122",
        "subjectName": "应收账款",
        "auxiliaryItemIds": "",
        "auxiliaryItemName": "",
        "currencyCode": "CNY",
        "baseCurrencyCode": "CNY",
        "initialBalance": null,
        "finished": null,
        "categoryName": "",
        "remark": ""
      }
    ],
    "summaries": [
      {
        "amount": "0.00",
        "balance": "0.00",
        "baseAmount": "0.00",
        "baseBalance": "0.00",
        "settledAmount": null,
        "badDebtAmount": null,
        "offsetAmount": null,
        "returnAmount": null,
        "kind": "total",
        "currencyCode": "",
        "baseCurrencyCode": ""
      }
    ],
    "coverage": "unverified",
    "notice": "仅返回指定方向、期间和页码的应收应付；totalCount 为接口声明的记录数，完整性尚未独立核验。合计与上一页总计不是往来记录，不重复相加。null 表示未提供，不当作零；保留币种与正负号，不跨币种加总。辅助项目名称不等同于已核实的客户或供应商身份；结清及已收已付金额不证明真实银行收付款。未执行新增、删除或核销。"
  },
  "publishedXlsx": true,
  "hashMatchesBytes": true
}
