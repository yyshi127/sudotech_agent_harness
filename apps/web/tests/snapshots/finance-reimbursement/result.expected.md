[
  [
    {
      "type": "tool-result",
      "toolCallId": "reimbursement-legacy",
      "content": [
        {
          "type": "text",
          "text": "所选报销单模板没有附件组件，无法随单据传入发票原件。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reimbursement-cancel-1",
      "content": [
        {
          "type": "text",
          "text": "Error: the user cancelled ask_user_question"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reimbursement-cancel-2",
      "content": [
        {
          "type": "text",
          "text": "Error: 用户确认尚未完成或已取消：暂停报销及附件写入，等待用户新的明确指令。不得猜测、合并发票或更换模板；再次创建仍需逐单确认。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reimbursement-cancel-3",
      "content": [
        {
          "type": "text",
          "text": "Error: 用户确认尚未完成或已取消：暂停报销及附件写入，等待用户新的明确指令。不得猜测、合并发票或更换模板；再次创建仍需逐单确认。"
        }
      ],
      "isError": true
    }
  ],
  [
    {
      "type": "tool-result",
      "toolCallId": "reimbursement-draft",
      "content": [
        {
          "type": "text",
          "text": "{\"schemaVersion\":1,\"operationId\":\"<operation-id>\",\"owner\":\"<client-id>/finance-reimbursement-chat\",\"revision\":1,\"phase\":\"draft\",\"attachmentNames\":[\"invoice.pdf\",\"invoice.png\"],\"message\":\"已回查：报销单处于待提交草稿状态，未提交审批、未支付。附件链接已随单据传入；有成是否转存原件尚未核验。\",\"orderCode\":\"BX-SNAPSHOT-001\"}"
        }
      ],
      "isError": false
    }
  ]
]
