{
  "report": {
    "accountId": "35601",
    "accountName": "余额测试账套",
    "selection": {
      "month": "2026-09",
      "compareMonth": "2026-08",
      "subjectLevel": 1
    },
    "currencyBasis": "ledger-base",
    "coverage": "unverified",
    "current": {
      "accountId": "35601",
      "accountName": "余额测试账套",
      "month": "2026-09",
      "monthEnd": "2026-09",
      "subjectLevel": 1,
      "subjectLevelEnd": 1,
      "rows": [
        {
          "subjectCode": "1001",
          "subjectName": "库存现金",
          "subjectLevel": 1,
          "hasChild": true,
          "subjectInfoId": 1,
          "parentSubjectId": 0,
          "periodInitialBorrow": "1000.00",
          "periodInitialLoan": null,
          "periodInitialBalance": null,
          "periodThisBorrow": "25.50",
          "periodThisLoan": "173.28",
          "periodThisBalance": "-147.78",
          "periodYearBorrow": "25.50",
          "periodYearLoan": "173.28",
          "periodYearBalance": "-147.78",
          "periodFinalBorrow": "852.22",
          "periodFinalLoan": null,
          "periodFinalBalance": null
        }
      ],
      "summaries": [
        {
          "subjectCode": "",
          "subjectName": "本期合计",
          "subjectLevel": 1,
          "hasChild": false,
          "periodInitialBorrow": "1000.00",
          "periodInitialLoan": null,
          "periodInitialBalance": null,
          "periodThisBorrow": "198.78",
          "periodThisLoan": "198.78",
          "periodThisBalance": "-147.78",
          "periodYearBorrow": "25.50",
          "periodYearLoan": "173.28",
          "periodYearBalance": "-147.78",
          "periodFinalBorrow": "852.22",
          "periodFinalLoan": null,
          "periodFinalBalance": null
        }
      ],
      "coverage": "unverified",
      "notice": "金额保留接口借贷列及正负号，借贷不统一解释为进出或增减；Balance 只称接口余额。null 在科目行和汇总行均写“未提供”，不能写零或“无（空）”。发生额留空只能说明未提供，不能称“本期无发生”；期初期末相等也不能证明期间没有发生。不从金额相同推断划转，不自行展开算式。科目行可能含父子层级，小计和合计单独列出，禁止将这些行重复加总。接口 count 不能证明数据完整；没有科目行不代表账套无余额或无异常。未执行任何写操作。"
    },
    "baseline": {
      "accountId": "35601",
      "accountName": "余额测试账套",
      "month": "2026-08",
      "monthEnd": "2026-08",
      "subjectLevel": 1,
      "subjectLevelEnd": 1,
      "rows": [
        {
          "subjectCode": "1001",
          "subjectName": "库存现金",
          "subjectLevel": 1,
          "hasChild": true,
          "subjectInfoId": 1,
          "parentSubjectId": 0,
          "periodInitialBorrow": "1000.00",
          "periodInitialLoan": null,
          "periodInitialBalance": null,
          "periodThisBorrow": "25.50",
          "periodThisLoan": "173.28",
          "periodThisBalance": "-147.78",
          "periodYearBorrow": "25.50",
          "periodYearLoan": "173.28",
          "periodYearBalance": "-147.78",
          "periodFinalBorrow": "852.22",
          "periodFinalLoan": null,
          "periodFinalBalance": null
        }
      ],
      "summaries": [
        {
          "subjectCode": "",
          "subjectName": "本期合计",
          "subjectLevel": 1,
          "hasChild": false,
          "periodInitialBorrow": "1000.00",
          "periodInitialLoan": null,
          "periodInitialBalance": null,
          "periodThisBorrow": "198.78",
          "periodThisLoan": "198.78",
          "periodThisBalance": "-147.78",
          "periodYearBorrow": "25.50",
          "periodYearLoan": "173.28",
          "periodYearBalance": "-147.78",
          "periodFinalBorrow": "852.22",
          "periodFinalLoan": null,
          "periodFinalBalance": null
        }
      ],
      "coverage": "unverified",
      "notice": "金额保留接口借贷列及正负号，借贷不统一解释为进出或增减；Balance 只称接口余额。null 在科目行和汇总行均写“未提供”，不能写零或“无（空）”。发生额留空只能说明未提供，不能称“本期无发生”；期初期末相等也不能证明期间没有发生。不从金额相同推断划转，不自行展开算式。科目行可能含父子层级，小计和合计单独列出，禁止将这些行重复加总。接口 count 不能证明数据完整；没有科目行不代表账套无余额或无异常。未执行任何写操作。"
    },
    "returnedRowSums": {
      "current": {
        "periodInitialBorrow": "1000.00",
        "periodInitialLoan": null,
        "periodThisBorrow": "25.50",
        "periodThisLoan": "173.28",
        "periodYearBorrow": "25.50",
        "periodYearLoan": "173.28",
        "periodFinalBorrow": "852.22",
        "periodFinalLoan": null
      },
      "baseline": {
        "periodInitialBorrow": "1000.00",
        "periodInitialLoan": null,
        "periodThisBorrow": "25.50",
        "periodThisLoan": "173.28",
        "periodYearBorrow": "25.50",
        "periodYearLoan": "173.28",
        "periodFinalBorrow": "852.22",
        "periodFinalLoan": null
      }
    },
    "reconciliation": {
      "current": {
        "periodInitialBorrow": {
          "providedSum": "1000.00",
          "missingCells": 0,
          "vendorTotal": "1000.00",
          "status": "matched"
        },
        "periodInitialLoan": {
          "providedSum": null,
          "missingCells": 1,
          "vendorTotal": null,
          "status": "total-unavailable"
        },
        "periodThisBorrow": {
          "providedSum": "25.50",
          "missingCells": 0,
          "vendorTotal": "198.78",
          "status": "mismatch"
        },
        "periodThisLoan": {
          "providedSum": "173.28",
          "missingCells": 0,
          "vendorTotal": "198.78",
          "status": "mismatch"
        },
        "periodYearBorrow": {
          "providedSum": "25.50",
          "missingCells": 0,
          "vendorTotal": "25.50",
          "status": "matched"
        },
        "periodYearLoan": {
          "providedSum": "173.28",
          "missingCells": 0,
          "vendorTotal": "173.28",
          "status": "matched"
        },
        "periodFinalBorrow": {
          "providedSum": "852.22",
          "missingCells": 0,
          "vendorTotal": "852.22",
          "status": "matched"
        },
        "periodFinalLoan": {
          "providedSum": null,
          "missingCells": 1,
          "vendorTotal": null,
          "status": "total-unavailable"
        }
      },
      "baseline": {
        "periodInitialBorrow": {
          "providedSum": "1000.00",
          "missingCells": 0,
          "vendorTotal": "1000.00",
          "status": "matched"
        },
        "periodInitialLoan": {
          "providedSum": null,
          "missingCells": 1,
          "vendorTotal": null,
          "status": "total-unavailable"
        },
        "periodThisBorrow": {
          "providedSum": "25.50",
          "missingCells": 0,
          "vendorTotal": "198.78",
          "status": "mismatch"
        },
        "periodThisLoan": {
          "providedSum": "173.28",
          "missingCells": 0,
          "vendorTotal": "198.78",
          "status": "mismatch"
        },
        "periodYearBorrow": {
          "providedSum": "25.50",
          "missingCells": 0,
          "vendorTotal": "25.50",
          "status": "matched"
        },
        "periodYearLoan": {
          "providedSum": "173.28",
          "missingCells": 0,
          "vendorTotal": "173.28",
          "status": "matched"
        },
        "periodFinalBorrow": {
          "providedSum": "852.22",
          "missingCells": 0,
          "vendorTotal": "852.22",
          "status": "matched"
        },
        "periodFinalLoan": {
          "providedSum": null,
          "missingCells": 1,
          "vendorTotal": null,
          "status": "total-unavailable"
        }
      }
    },
    "reconciliationCounts": {
      "current": {
        "matched": 4,
        "mismatch": 2,
        "total-unavailable": 2,
        "unsupported-level": 0
      },
      "baseline": {
        "matched": 4,
        "mismatch": 2,
        "total-unavailable": 2,
        "unsupported-level": 0
      }
    },
    "reconciliationNotice": "小兢会计仅核对一级科目已提供金额之和与唯一的本期合计。matched 表示该列金额一致，不证明空值为零、科目无遗漏或全账套完整；其他状态不视为通过。保留空值数，不合计父子级或小计行。总结列数直接使用本次 reconciliationCounts，每个期间共八个借贷列，四个 Balance 来源字段不参与核对。不要沿用历史回答中的计数；若历史回答与本次计数冲突，明确纠正。正文、括号说明及结论都必须与本次计数一致，不再重新数列。",
    "differences": [
      {
        "subjectInfoId": 1,
        "subjectCode": "1001",
        "subjectName": "库存现金",
        "presence": "both",
        "amounts": {
          "periodInitialBorrow": "0.00",
          "periodInitialLoan": null,
          "periodThisBorrow": "0.00",
          "periodThisLoan": "0.00",
          "periodYearBorrow": "0.00",
          "periodYearLoan": "0.00",
          "periodFinalBorrow": "0.00",
          "periodFinalLoan": null
        }
      }
    ],
    "notice": "小兢会计按同一账套本位币、同一单层级计算。差额方向为当前月减基准月，逐列比较，不表示现金收支或正常异常；本年累计列仍为各月接口的年累计值。仅一边出现的科目或缺失金额均不可计算，不补零。returnedRowSums 仅为返回科目行的同列加总，任一金额未提供则该列合计未知；不包含接口汇总，不跨父子层级重复累计。全范围完整性尚未核验，不是全账套合计或试算平衡结论。两次读取不保证原子快照。"
  },
  "publishedXlsx": true,
  "hashMatchesBytes": true
}
