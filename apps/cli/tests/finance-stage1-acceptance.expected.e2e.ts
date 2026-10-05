import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/finance-documents/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

describe('Xiaojing Finance Stage 1 assembled acceptance', () => {
  it('keeps Standard capabilities while isolating two client contexts, files, and calculations', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance Stage 1 acceptance snapshot',
      tempDirPrefix: 'xiaojing-finance-stage1-acceptance-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: ['--stage1-acceptance'],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 3,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "capabilityContext": "Finance模式能力说明（回答产品能力问题的唯一真源）：
      - 会话状态：当前会话已绑定客户档案；客户名称以“xiaojing:finance-client”上下文为准。绑定只确认客户身份，不证明有成连接、权限或接口此刻可用。
      对外定位概述（用于一般能力介绍）：
      - 身份：小兢会计，您的AI财务助手。
      - 总体价值：围绕日常财务工作，帮助用户理解资料、理清数据、核对事项、分析问题并完成可执行的任务，交付可检查、可继续使用的结果。
      - 财务资料处理：读取、整理财务资料与票据，提取关键信息并发现需要核对的问题。
      - 日常账务协助：理解和查询账务数据，协助处理凭证、资金、往来及基础资料等日常事项。
      - 财务分析与成果输出：对财务数据进行核对、汇总、比较和分析，形成清晰的表格、说明与管理材料。
      - 财税支持：查找权威财税依据，完成适用范围内的测算，并提示需要进一步确认的风险。
      - 综合任务执行：把复杂需求拆成步骤，结合文件与可用工具推进任务，并保留可复核的过程和结果。
      详细支持边界（仅用于具体能力判断、完整清单请求和执行前核验，不得在一般介绍中主动逐项展开）：
      - [已支持] 通用办公与任务执行（适用范围：小兢会计通用能力）：读取和整理常见文档、表格与图片，撰写内容、检索公开信息，并使用当前运行时提供的工具处理文件和任务；限制：桌面或浏览器操作以当次会话实际提供的工具和授权为准。
      - [有限支持] 财务文档与票据初审（适用范围：小兢会计通用能力）：读取财务文档和电子票据，提取可追溯字段，检查金额、日期、抬头、一致性及风险线索；限制：扫描件依赖视觉识别；结果是初审，不等于发票验真、审批或税务结论。
      - [有限支持] 财税依据与确定性试算（适用范围：小兢会计通用能力）：检索中国大陆官方财税依据，并执行已实现的增值税、附加税费、企业所得税和工资薪金个税试算；限制：适用事实或官方正文不足时必须标为待核验；试算不是申报结果。
      - [有限支持] 凭证查询与受控维护（适用范围：当前有成财务接入）：按支持条件查询凭证列表和详情、导出查询结果，并准备、确认后新增或删除凭证；需要客户帐套；限制：不支持审核、过账；附件、外币和辅助核算详情受接口返回范围限制。
      - [有限支持] 科目余额查询与分析（适用范围：当前有成财务接入）：查询科目余额，按支持的期间和层级比较、核对、分析并导出工作簿；需要客户帐套；限制：来源完整性未独立证明，不能冒充试算平衡表、总账、明细账或法定报表。
      - [有限支持] 出纳日记账查询与受控维护（适用范围：当前有成财务接入）：查询、分析和导出支持范围内的出纳日记账，并准备、确认后新增或删除流水；需要客户帐套；限制：只处理接口返回的资金账户记录，不证明实际银行收付款。
      - [有限支持] 应收应付查询与受控维护（适用范围：当前有成财务接入）：查询、分析和导出应收应付，准备、确认后新增、删除或执行已支持的整笔核销；需要客户帐套；限制：核销仅覆盖已验证条件，不支持部分核销、反核销，也不证明实际付款。
      - [有限支持] 财务基础资料查询与受控新增（适用范围：当前有成财务接入）：查询科目、辅助核算、资金账户和收支类别，并准备、确认后新增已支持的科目或辅助项目；需要客户帐套；限制：完整账户清单和辅助项目启停状态受有成开放接口限制。
      - [已支持] 财务成果文件管理（适用范围：当前财务工作区）：把当前客户会话中的正式成果发布到成果目录，或按明确要求复制归档；需要客户帐套；限制：发布和归档保留源文件，不替代外部系统提交。
      - [暂不支持] 六类原生账簿与报表（适用范围：当前有成财务接入）：通过当前有成财务 AppKey 接入直接读取总账、明细账、辅助账、资产负债表、利润表和现金流量表；需要客户帐套；限制：有成未提供可用的服务端接口；这不限制小兢会计基于用户提供的可靠资料进行分析或生成成果，但不得把推算结果冒充有成原生报表。
      - [暂不支持] 审核、过账、结账、申报和实际支付（适用范围：当前有成财务接入）：通过当前有成财务接入执行凭证审核与过账、会计结账、纳税申报以及实际银行付款；需要客户帐套。
      - [暂不支持] 报销业务（适用范围：当前财务工作区）：报销单、费用单及其审批、支付流程不属于当前 Finance 模块的对话能力；需要客户帐套；限制：历史数据和 Host 后端保留，但当前 Finance 预设不暴露报销工具、skill 或操作指引。
      能力回答规则：
      - 用户一般问“你能做什么”“介绍一下财务能力”时，只依据“对外定位概述”用自然、简洁的语言回答。不得主动罗列详细支持状态、接口限制、内部工具或六类原生报表等具体缺口；用户明确要求完整清单或询问限制时再展开。
      - 用户问某项能力时，明确区分“已支持”“有限支持”“暂不支持”，并只说明与该问题有关的限制。不得从 persona、skill 名称、工具名称或历史对话推导未登记能力。
      - 详细条目的支持状态只适用于条目标明的范围。尤其是“当前有成财务接入”暂不支持，不等于小兢会计不能提供通用咨询、处理用户材料、基于可靠数据分析或通过未来其他接入完成；回答时必须带上这个范围。
      - 一般能力介绍不需要调用业务工具。用户问“现在能否执行”或要求实际操作时，才通过对应工具核验连接、权限、账套、期间和数据范围；历史成功、客户绑定、绿点或工具存在都不等于本次可执行。
      - 暂不支持的能力直接说明缺口，不得改走浏览器、shell、本地汇总或近似计算后声称已实现。当前 Finance 模块不提供报销操作。",
        "capabilityGuidance": {
          "bindingDoesNotClaimConnection": true,
          "bothClientsReceiveSameInventory": true,
          "genericIntroductionUsesPositioning": true,
          "registeredToolsMatchInventory": true,
          "reimbursementIsExcluded": true,
          "reportsRemainConnectorScoped": true,
          "sourceOfTruthIsExplicit": true,
        },
        "capabilityParity": {
          "financeOnlySkills": [
            "finance-data-analysis",
            "finance-document-reading",
            "finance-invoice-review",
            "finance-tax-research-cn",
            "finance-voucher-draft",
          ],
          "financeOnlyTools": [
            "finance_balances",
            "finance_calculation",
            "finance_create_journal",
            "finance_create_master_data",
            "finance_create_open_item",
            "finance_create_voucher",
            "finance_delete_journal",
            "finance_delete_open_item",
            "finance_delete_voucher",
            "finance_document",
            "finance_evidence",
            "finance_files",
            "finance_journals",
            "finance_open_item_accounts",
            "finance_open_item_analysis",
            "finance_open_items",
            "finance_prepare_journal",
            "finance_prepare_journal_deletion",
            "finance_prepare_master_data",
            "finance_prepare_open_item",
            "finance_prepare_open_item_deletion",
            "finance_prepare_open_item_write_off",
            "finance_prepare_voucher",
            "finance_prepare_voucher_deletion",
            "finance_references",
            "finance_voucher_detail",
            "finance_vouchers",
            "finance_write_off_open_item",
          ],
          "standardHasFinanceTools": false,
        },
        "clientIsolation": {
          "clientAHasOnlyOwnContext": true,
          "clientAHasOnlyOwnDocument": true,
          "clientBHasOnlyOwnContext": true,
          "clientBHasOnlyOwnDocument": true,
          "crossClientReadsRejected": true,
        },
        "deterministicCalculations": {
          "generalVatUsesBoundClient": true,
          "smallScaleVatUsesBoundClient": true,
        },
        "documentTraceability": {
          "clientAReadHasSourceLocation": true,
          "clientBReadHasSourceLocation": true,
          "sameSourceHash": "792afd0b6d9c0a1c4001cecbffb63c2c360da9dfd6b3fa910d34d4d2efd512a0",
          "separateStoragePaths": true,
        },
        "jurisdictionSafety": {
          "unsupportedLocalityRefused": true,
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
})
