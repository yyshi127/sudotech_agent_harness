[
  {
    "kind": "subject",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100297\",\"subjectName\":\"基础资料测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[]}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100297\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[]}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送基础资料。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100297\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "kind": "subject",
    "root": true,
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"1099\",\"subjectName\":\"基础资料测试科目\",\"parentCode\":null,\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":null,\"parentImpact\":\"new-root\",\"sameNameElsewhere\":[]}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"1099\",\"subjectName\":\"修改后测试科目\",\"parentCode\":null,\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":null,\"parentImpact\":\"new-root\",\"sameNameElsewhere\":[]}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送基础资料。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"1099\",\"subjectName\":\"修改后测试科目\",\"parentCode\":null,\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null}},\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "kind": "auxiliary-item",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"auxiliary-item\",\"input\":{\"categoryCode\":\"02\",\"itemCode\":\"F3A02\",\"itemName\":\"基础资料测试供应商\",\"documentMaker\":\"施\",\"status\":\"enabled\"}},\"references\":{\"kind\":\"auxiliary-item\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"categoryId\":\"473815\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\"}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"auxiliary-item\",\"input\":{\"categoryCode\":\"02\",\"itemCode\":\"F3A02\",\"itemName\":\"修改后测试供应商\",\"documentMaker\":\"施\",\"status\":\"enabled\"}},\"references\":{\"kind\":\"auxiliary-item\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"categoryId\":\"473815\",\"categoryCode\":\"02\",\"categoryName\":\"供应商\"}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送基础资料。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"matched\",\"status\":\"unavailable\",\"complete\":false},\"complete\":false}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"outcome-unknown\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"auxiliary-item\",\"input\":{\"categoryCode\":\"02\",\"itemCode\":\"F3A02\",\"itemName\":\"修改后测试供应商\",\"documentMaker\":\"施\",\"status\":\"enabled\"}},\"outcome\":{\"state\":\"outcome-unknown\"},\"readback\":{\"content\":\"matched\",\"status\":\"unavailable\",\"complete\":false},\"complete\":false}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "auxiliary-item-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "kind": "subject",
    "accounting": "auxiliary",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100294\",\"subjectName\":\"基础资料测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[\"02\"],\"currencyCodes\":[]}}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[],\"accounting\":{\"auxiliaryCategories\":[{\"id\":\"473815\",\"code\":\"02\",\"name\":\"供应商\"}],\"currencies\":[]}}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100294\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[\"02\"],\"currencyCodes\":[]}}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[],\"accounting\":{\"auxiliaryCategories\":[{\"id\":\"473815\",\"code\":\"02\",\"name\":\"供应商\"}],\"currencies\":[]}}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送基础资料。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100294\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[\"02\"],\"currencyCodes\":[]}}},\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  },
  {
    "kind": "subject",
    "accounting": "currency",
    "writes": 1,
    "results": [
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-1",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100293\",\"subjectName\":\"基础资料测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[],\"currencyCodes\":[\"USD\"]}}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[],\"accounting\":{\"auxiliaryCategories\":[],\"currencies\":[{\"code\":\"USD\",\"name\":\"美元\"}]}}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-2",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100293\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[],\"currencyCodes\":[\"USD\"]}}},\"references\":{\"kind\":\"subject\",\"accountId\":\"35616\",\"accountName\":\"基础资料演示账套\",\"parent\":{\"code\":\"1002\",\"name\":\"银行存款\"},\"parentImpact\":\"existing-branch\",\"sameNameElsewhere\":[],\"accounting\":{\"auxiliaryCategories\":[],\"currencies\":[{\"code\":\"USD\",\"name\":\"美元\"}]}}}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-3",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-4",
          "content": [
            {
              "type": "text",
              "text": "Error: 未获得本次准确版本的确认，没有发送基础资料。"
            }
          ],
          "isError": true
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-5",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-6",
          "content": [
            {
              "type": "text",
              "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"accepted\",\"account\":{\"id\":\"35616\",\"name\":\"基础资料演示账套\"},\"proposal\":{\"kind\":\"subject\",\"input\":{\"subjectCode\":\"100293\",\"subjectName\":\"修改后测试科目\",\"parentCode\":\"1002\",\"subjectCategory\":\"1\",\"subjectType\":\"流动资产\",\"direction\":\"debit\",\"status\":\"enabled\",\"documentMaker\":\"施\",\"numberUnit\":null,\"accounting\":{\"auxiliaryCategoryCodes\":[],\"currencyCodes\":[\"USD\"]}}},\"outcome\":{\"state\":\"accepted\"},\"readback\":{\"content\":\"matched\",\"configuration\":\"matched\",\"complete\":true},\"complete\":true}"
            }
          ],
          "isError": false
        }
      ],
      [
        {
          "type": "tool-result",
          "toolCallId": "subject-7",
          "content": [
            {
              "type": "text",
              "text": "Error: 基础资料版本已变化或已有发送记录，请查看原记录。"
            }
          ],
          "isError": true
        }
      ]
    ]
  }
]
