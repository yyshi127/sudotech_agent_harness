/** Weixin-specific plain-text formatting and bounded delivery chunks. */

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/
const CODE_BLOCK = /```(?:[^\n]*)\n([\s\S]*?)```/g

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(value => value.trim())
}

function renderTable(lines: readonly string[]): string[] {
  const header = cells(lines[0] as string)
  return lines.slice(2).map((line) => {
    const values = cells(line)
    if (header.length === 2 && values.length >= 2) return `• ${values[0]}：${values[1]}`
    const fields = header.map((name, index) => `${name || `字段${index + 1}`}：${values[index] ?? ''}`)
    return `• ${fields.join('；')}`
  })
}

function convertTables(markdown: string): string {
  const input = markdown.split('\n')
  const output: string[] = []
  for (let index = 0; index < input.length;) {
    const next = input[index + 1]
    if (input[index]?.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next)) {
      let end = index + 2
      while (end < input.length && input[end]?.includes('|') && input[end]?.trim() !== '') end += 1
      output.push(...renderTable(input.slice(index, end)))
      index = end
      continue
    }
    output.push(input[index] as string)
    index += 1
  }
  return output.join('\n')
}

/**
 * Convert model Markdown to compact mobile plain text without changing the desktop transcript.
 * @param markdown - finalized assistant text stored in the Harness session.
 * @returns Weixin-friendly text with headings, lists, tables, links, and code made explicit.
 */
export function formatWeixinText(markdown: string): string {
  const code: string[] = []
  let text = markdown.replace(/\r\n?/g, '\n').replace(CODE_BLOCK, (_match, body: string) => {
    const marker = `@@XIAOJINGCODEBLOCK${code.length}@@`
    code.push(body.trimEnd())
    return marker
  })
  text = convertTables(text)
    .replace(/^#{1,6}\s+(.+)$/gm, '【$1】')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '────────')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s*>\s?/gm, '｜')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1（图片：$2）')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/`([^`\n]+)`/g, '「$1」')
  for (let index = 0; index < code.length; index += 1) {
    text = text.replace(`@@XIAOJINGCODEBLOCK${index}@@`, `—— 代码 ——\n${code[index]}\n—— 结束 ——`)
  }
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function takeCodePoints(value: string, count: number): [string, string] {
  const points = Array.from(value)
  return [points.slice(0, count).join(''), points.slice(count).join('')]
}

/**
 * Split one formatted reply at paragraph and line boundaries for iLink delivery.
 * @param text - formatted non-empty reply.
 * @param maxChars - maximum Unicode code points in each message, including the part label.
 * @returns ordered non-empty message chunks.
 */
export function splitWeixinText(text: string, maxChars: number): string[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 200) throw new RangeError('maxChars must be an integer of at least 200')
  const budget = maxChars - 12
  const units = text.split(/\n{2,}/).flatMap((paragraph) => {
    if (Array.from(paragraph).length <= budget) return [paragraph]
    return paragraph.split('\n').flatMap((line) => {
      const chunks: string[] = []
      let remaining = line
      while (Array.from(remaining).length > budget) {
        const [head, tail] = takeCodePoints(remaining, budget)
        chunks.push(head)
        remaining = tail
      }
      if (remaining !== '') chunks.push(remaining)
      return chunks
    })
  }).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    const candidate = current === '' ? unit : `${current}\n\n${unit}`
    if (Array.from(candidate).length <= budget) {
      current = candidate
      continue
    }
    if (current !== '') chunks.push(current)
    current = unit
  }
  if (current !== '') chunks.push(current)
  if (chunks.length <= 1) return chunks
  return chunks.map((chunk, index) => `（${index + 1}/${chunks.length}）\n${chunk}`)
}
