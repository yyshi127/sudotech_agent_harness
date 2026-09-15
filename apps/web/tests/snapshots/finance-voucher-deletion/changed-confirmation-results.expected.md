[
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-1",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":1,\"phase\":\"prepared\",\"preview\":{\"detail\":{\"accountId\":\"35616\",\"accountName\":\"删除演示账套\",\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"period\":\"2022-01\",\"audited\":false,\"settled\":false,\"documentMaker\":\"测试\",\"rows\":[{\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"summary\":\"删除专用测试\",\"subjectCode\":\"1001\",\"subjectName\":\"测试科目\",\"debit\":\"0.01\",\"credit\":\"0.00\"},{\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"summary\":\"删除专用测试\",\"subjectCode\":\"100201\",\"subjectName\":\"测试科目\",\"debit\":\"0.00\",\"credit\":\"0.01\"}],\"notice\":\"仅为指定凭证的会计分录、期间和审核/结账状态；不包含附件、辅助核算及外币明细，不代表这些资料不存在。未执行任何写操作。\"},\"fingerprint\":\"d28056e6c741f9bd6039f879320454ab06aa0b10799e915a163a16ccfc1ec67e\",\"modified\":\"2026-09-10\",\"channel\":\"EXTERNAL_ACCESS\",\"attachmentCount\":0,\"auxiliaryEntryCount\":0,\"currencyCodes\":[],\"blockers\":[],\"notice\":\"仅检查指定凭证的当前状态及已返回关联；空列表不证明没有其他关联。未执行删除，未取得删除授权。指纹变化需重新预览，不提供供应商并发锁。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\"},\"notice\":\"仅准备删除预览。删除会移除指定凭证及分录，不联动删除其他业务，不审核、结账或实际收付款；不提供自动撤销。必须另行确认准确版本，当前尚未发送。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-2",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":{\"detail\":{\"accountId\":\"35616\",\"accountName\":\"删除演示账套\",\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"period\":\"2022-01\",\"audited\":false,\"settled\":false,\"documentMaker\":\"测试\",\"rows\":[{\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"summary\":\"删除专用测试\",\"subjectCode\":\"1001\",\"subjectName\":\"测试科目\",\"debit\":\"0.01\",\"credit\":\"0.00\"},{\"voucherId\":\"125\",\"date\":\"2022-01-01\",\"number\":\"记-40\",\"summary\":\"删除专用测试\",\"subjectCode\":\"100201\",\"subjectName\":\"测试科目\",\"debit\":\"0.00\",\"credit\":\"0.01\"}],\"notice\":\"仅为指定凭证的会计分录、期间和审核/结账状态；不包含附件、辅助核算及外币明细，不代表这些资料不存在。未执行任何写操作。\"},\"fingerprint\":\"d28056e6c741f9bd6039f879320454ab06aa0b10799e915a163a16ccfc1ec67e\",\"modified\":\"2026-09-10\",\"channel\":\"EXTERNAL_ACCESS\",\"attachmentCount\":0,\"auxiliaryEntryCount\":0,\"currencyCodes\":[],\"blockers\":[],\"notice\":\"仅检查指定凭证的当前状态及已返回关联；空列表不证明没有其他关联。未执行删除，未取得删除授权。指纹变化需重新预览，不提供供应商并发锁。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\"},\"notice\":\"仅准备删除预览。删除会移除指定凭证及分录，不联动删除其他业务，不审核、结账或实际收付款；不提供自动撤销。必须另行确认准确版本，当前尚未发送。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\"}"
        }
      ],
      "isError": false
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-3",
      "content": [
        {
          "type": "text",
          "text": "Error: 删除版本已变化或存在发送记录，不得重复发送。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-4",
      "content": [
        {
          "type": "text",
          "text": "Error: 未获得本次准确版本的删除确认，没有发送。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-5",
      "content": [
        {
          "type": "text",
          "text": "Error: 凭证删除预览内容已变化，请重新确认。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "deletion-6",
      "content": [
        {
          "type": "text",
          "text": "{\"id\":\"<deletion-id>\",\"version\":2,\"phase\":\"prepared\",\"preview\":\"{\\\"detail\\\":{\\\"accountId\\\":\\\"35616\\\",\\\"accountName\\\":\\\"删除演示账套\\\",\\\"voucherId\\\":\\\"125\\\",\\\"date\\\":\\\"2022-01-01\\\",\\\"number\\\":\\\"记-40\\\",\\\"period\\\":\\\"2022-01\\\",\\\"audited\\\":false,\\\"settled\\\":false,\\\"documentMaker\\\":\\\"测试\\\",\\\"rows\\\":[{\\\"voucherId\\\":\\\"125\\\",\\\"date\\\":\\\"2022-01-01\\\",\\\"number\\\":\\\"记-40\\\",\\\"summary\\\":\\\"删除专用测试\\\",\\\"subjectCode\\\":\\\"1001\\\",\\\"subjectName\\\":\\\"测试科目\\\",\\\"debit\\\":\\\"0.01\\\",\\\"credit\\\":\\\"0.00\\\"},{\\\"voucherId\\\":\\\"125\\\",\\\"date\\\":\\\"2022-01-01\\\",\\\"number\\\":\\\"记-40\\\",\\\"summary\\\":\\\"删除专用测试\\\",\\\"subjectCode\\\":\\\"100201\\\",\\\"subjectName\\\":\\\"测试科目\\\",\\\"debit\\\":\\\"0.00\\\",\\\"credit\\\":\\\"0.01\\\"}],\\\"notice\\\":\\\"仅为指定凭证的会计分录、期间和审核/结账状态；不包含附件、辅助核算及外币明细，不代表这些资料不存在。未执行任何写操作。\\\"},\\\"fingerprint\\\":\\\"d28056e6c741f9bd6039f879320454ab06aa0b10799e915a163a16ccfc1ec67e\\\",\\\"modified\\\":\\\"2026-09-10\\\",\\\"channel\\\":\\\"EXTERNAL_ACCESS\\\",\\\"attachmentCount\\\":0,\\\"auxiliaryEntryCount\\\":0,\\\"currencyCodes\\\":[],\\\"blockers\\\":[],\\\"notice\\\":\\\"内容变化：仅检查指定凭证的当前状态及已返回关联；空列表不证明没有其他关联。未执行删除，未取得删除授权。指纹变化需重新预览，不提供供应商并发锁。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\\\"}\\n\",\"readback\":{\"state\":\"not-checked\"},\"notice\":\"仅只读复查。accepted 不等于已删除，unavailable 不等于不存在；不得重新发送未知结果。本操作不清理原OSS文件；凭证删除不证明有成转存附件已清除，也不保证附件长期保留。\"}"
        }
      ],
      "isError": false
    }
  ]
]
