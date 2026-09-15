[
  [
    {
      "type": "tool-result",
      "toolCallId": "recovery-1-1",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"已更正制单人\",\"certificateCode\":35,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"outcome\":{\"state\":\"outcome-unknown\"},\"originals\":[],\"complete\":false,\"notice\":\"仅按原凭证ID只读回查，不重新发送。complete 仅表示本张凭证的会计数据、辅助核算、原币／汇率及所选原件技术核验，不证明票据真实、会计处理恰当或已审核过账。原件以 readback.originals 为准；pending 需等源链接到期后再查，unavailable 不等于没有附件。结果未知且没有ID时需人工核实，不推定未创建。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "recovery-2-1",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"已更正制单人\",\"certificateCode\":35,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"outcome\":{\"state\":\"accepted\",\"voucherId\":\"270825\"},\"readback\":{\"accounting\":\"matched\",\"auxiliary\":\"matched\",\"currency\":\"matched\",\"originals\":{\"association\":\"not-required\",\"retention\":\"not-required\",\"verifiedCount\":0,\"metadataWarning\":false},\"complete\":true},\"originals\":[],\"complete\":true,\"notice\":\"仅按原凭证ID只读回查，不重新发送。complete 仅表示本张凭证的会计数据、辅助核算、原币／汇率及所选原件技术核验，不证明票据真实、会计处理恰当或已审核过账。原件以 readback.originals 为准；pending 需等源链接到期后再查，unavailable 不等于没有附件。结果未知且没有ID时需人工核实，不推定未创建。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "recovery-3-1",
      "content": [
        {
          "type": "text",
          "text": "Error: 有成凭证详情查询失败（account-query）；失败不等于凭证不存在，请核对连接和凭证 ID。"
        }
      ],
      "isError": true
    }
  ]
]
