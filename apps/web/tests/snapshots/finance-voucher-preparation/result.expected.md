[
  [
    {
      "type": "text",
      "text": "{\"id\":\"<prepared-id>\",\"version\":1,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"测试员\",\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[\"certificateCode\"]}"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"已更正制单人\",\"certificateCode\":35,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: 凭证版本或账套配置已变化，请重新预览确认。"
    }
  ],
  [
    {
      "type": "text",
      "text": "{\"id\":\"<prepared-id>\",\"version\":2,\"phase\":\"prepared\",\"account\":{\"id\":\"prepare-ledger\",\"name\":\"凭证准备演示\"},\"input\":{\"date\":\"2026-09-09\",\"documentMaker\":\"已更正制单人\",\"certificateCode\":35,\"entries\":[{\"summary\":\"银行取现\",\"subjectCode\":\"1001\",\"side\":\"debit\",\"amount\":\"0.30\",\"auxiliary\":[]},{\"summary\":\"银行取现\",\"subjectCode\":\"1002\",\"side\":\"credit\",\"amount\":\"0.30\",\"auxiliary\":[]}],\"sourcePaths\":[]},\"totalDebit\":\"0.30\",\"totalCredit\":\"0.30\",\"references\":[{\"subject\":{\"id\":\"1001\",\"code\":\"1001\",\"name\":\"库存现金\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]},{\"subject\":{\"id\":\"1002\",\"code\":\"1002\",\"name\":\"银行存款\",\"status\":\"enabled\",\"hasChildren\":false,\"auxiliaryCodes\":[],\"currencyCodes\":[]},\"auxiliary\":[]}],\"sources\":[],\"uploadedOriginals\":[],\"missingFields\":[]}"
    }
  ],
  [
    {
      "type": "text",
      "text": "Error: invalid arguments: \"action\" must be one of [\"prepare\",\"revise\",\"inspect\"]"
    }
  ]
]
