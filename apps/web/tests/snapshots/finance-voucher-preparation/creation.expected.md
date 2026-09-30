[
  {
    "mode": "accepted",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<accepted-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<accepted-id>\",\"version\":1,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"voucherId\":\"270826\"},\"readback\":{\"accounting\":\"matched\",\"auxiliary\":\"matched\",\"currency\":\"matched\",\"originals\":{\"association\":\"not-required\",\"retention\":\"not-required\",\"verifiedCount\":0,\"metadataWarning\":false},\"complete\":true},\"originals\":[],\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "response-loss",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<response-loss-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<response-loss-id>\",\"version\":1,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"accounting\":\"not-checked\",\"complete\":false},\"originals\":[],\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "changed-preview",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<changed-preview-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 确认后凭证或基础资料已变化，请重新预览确认。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "read-failed",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<read-failed-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<read-failed-id>\",\"version\":1,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"voucherId\":\"270826\"},\"readback\":{\"accounting\":\"unavailable\",\"complete\":false},\"originals\":[],\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "originals",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<originals-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[\"invoice.pdf\",\"invoice.png\"]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[{\"name\":\"invoice.pdf\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.pdf\"},{\"name\":\"invoice.png\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.png\"}],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<originals-id>\",\"version\":1,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"voucherId\":\"270826\"},\"readback\":{\"accounting\":\"matched\",\"auxiliary\":\"matched\",\"currency\":\"matched\",\"originals\":{\"association\":\"matched\",\"retention\":\"pending\",\"verifiedCount\":2,\"metadataWarning\":true},\"complete\":false},\"originals\":[{\"sourcePath\":\"invoice.pdf\",\"name\":\"invoice.pdf\",\"objectKey\":\"fixture/<client-id>/finance-vouchers/<originals-id>/invoice.pdf\",\"storageRevision\":1,\"expiresAt\":1900000000000,\"selected\":true,\"association\":\"unverified\"},{\"sourcePath\":\"invoice.png\",\"name\":\"invoice.png\",\"objectKey\":\"fixture/<client-id>/finance-vouchers/<originals-id>/invoice.png\",\"storageRevision\":1,\"expiresAt\":1900000000000,\"selected\":true,\"association\":\"unverified\"}],\"complete\":false}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "upload-failed",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<upload-failed-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[\"invoice.pdf\",\"invoice.png\"]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[{\"name\":\"invoice.pdf\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.pdf\"},{\"name\":\"invoice.png\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.png\"}],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 原件上传或回执保存未完成，没有发送凭证。已上传文件可能仍保留；请查看原记录和附件存储设置，不要省略失败附件。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<upload-failed-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[\"invoice.pdf\",\"invoice.png\"]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[{\"name\":\"invoice.pdf\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.pdf\"},{\"name\":\"invoice.png\",\"path\":\"<workspace>/preparation-client/02-原始资料/invoice.png\"}],\"uploadedOriginals\":[{\"sourcePath\":\"invoice.pdf\",\"name\":\"invoice.pdf\",\"objectKey\":\"fixture/<client-id>/finance-vouchers/<upload-failed-id>/invoice.pdf\",\"storageRevision\":1,\"expiresAt\":1900000000000,\"selected\":true,\"association\":\"unverified\"}],\"missingFields\":[]}"
        }
      ]
    ]
  },
  {
    "mode": "foreign",
    "results": [
      [
        {
          "type": "text",
          "text": "{\"id\":\"<foreign-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"certificateCode\":36,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"100299\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[],\"foreignCurrency\":{\"code\":\"USD\",\"amount\":\"0.20\",\"exchangeRate\":\"1.5\"}},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"100299\",\"code\":\"100299\",\"name\":\"外币测试\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[\"USD\"]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的创建确认，没有发送凭证。"
        }
      ],
      [
        {
          "type": "text",
          "text": "{\"id\":\"<foreign-id>\",\"version\":1,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\",\"voucherId\":\"270826\"},\"readback\":{\"accounting\":\"matched\",\"auxiliary\":\"matched\",\"currency\":\"matched\",\"originals\":{\"association\":\"not-required\",\"retention\":\"not-required\",\"verifiedCount\":0,\"metadataWarning\":false},\"complete\":true},\"originals\":[],\"complete\":true}"
        }
      ],
      [
        {
          "type": "text",
          "text": "Error: 凭证版本已变化或已有发送记录；请查看原记录，不得重复提交。"
        }
      ]
    ]
  },
  {
    "mode": "cancel-after-send",
    "phase": "accepted",
    "outcome": {
      "state": "accepted",
      "voucherId": "270826"
    },
    "recovered": true,
    "writes": 1
  }
]
