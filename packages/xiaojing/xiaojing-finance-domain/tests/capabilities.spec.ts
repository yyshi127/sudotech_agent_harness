import { describe, expect, it } from 'vitest'
import {
  FINANCE_CAPABILITIES,
  FINANCE_POSITIONING,
  renderFinanceCapabilityContext,
} from '../src/capabilities.ts'

describe('Finance capability inventory', () => {
  it('keeps one unique business entry and supporting tool list per capability', () => {
    const ids = FINANCE_CAPABILITIES.map(capability => capability.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const capability of FINANCE_CAPABILITIES) {
      expect(capability.title).not.toBe('')
      expect(capability.description).not.toBe('')
      expect(['general', 'workspace', 'youcheng']).toContain(capability.scope)
      expect(new Set(capability.toolNames).size).toBe(capability.toolNames.length)
      if (capability.status === 'unsupported') expect(capability.toolNames).toEqual([])
    }
  })

  it('defines a concise product-positioned introduction independently of detailed support boundaries', () => {
    expect(FINANCE_POSITIONING.identity).toBe('小兢会计，您的AI财务助手')
    expect(FINANCE_POSITIONING.areas.map(([title]) => title)).toEqual([
      '财务资料处理',
      '日常账务协助',
      '财务分析与成果输出',
      '财税支持',
      '综合任务执行',
    ])
    expect(JSON.stringify(FINANCE_POSITIONING)).not.toContain('六类原生账簿与报表')
  })

  it('renders positioning for introductions and retains detailed boundaries for specific questions', () => {
    const prompt = renderFinanceCapabilityContext({ clientBound: false })
    expect(prompt).toContain('回答产品能力问题的唯一真源')
    expect(prompt).toContain('当前会话是通用财务咨询，未绑定客户')
    expect(prompt).toContain('对外定位概述（用于一般能力介绍）')
    expect(prompt).toContain('小兢会计，您的AI财务助手')
    expect(prompt).toContain('财务分析与成果输出')
    expect(prompt).toContain('详细支持边界（仅用于具体能力判断、完整清单请求和执行前核验')
    expect(prompt).toContain('[有限支持] 凭证查询与受控维护（适用范围：当前有成财务接入）')
    expect(prompt).toContain('[暂不支持] 六类原生账簿与报表（适用范围：当前有成财务接入）')
    expect(prompt).toContain('[暂不支持] 报销业务（适用范围：当前财务工作区）')
    expect(prompt).toContain('这不限制小兢会计基于用户提供的可靠资料进行分析或生成成果')
    expect(prompt).toContain('支持状态只适用于条目标明的范围')
    expect(prompt).toContain('不得主动罗列详细支持状态、接口限制、内部工具或六类原生报表等具体缺口')
    expect(prompt).toContain('不得从 persona、skill 名称、工具名称或历史对话推导未登记能力')
    expect(prompt).toContain('一般能力介绍不需要调用业务工具')
  })

  it('does not equate a bound client with a working external connection', () => {
    const prompt = renderFinanceCapabilityContext({ clientBound: true })
    expect(prompt).toContain('当前会话已绑定客户档案')
    expect(prompt).toContain('绑定只确认客户身份，不证明有成连接、权限或接口此刻可用')
    expect(prompt).toContain('历史成功、客户绑定、绿点或工具存在都不等于本次可执行')
  })
})
