import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  financeDocumentKindFromName,
  normalizeFinanceDocument,
} from '../src/parser.ts'
import { extractPptxVisuals } from '../src/pptx.ts'
import { extractDocumentVisuals } from '../src/visuals.ts'
import type { FinanceDocumentParseLimits } from '../src/types.ts'

const limits: FinanceDocumentParseLimits = {
  maxFileBytes: 2_000_000,
  maxPdfPages: 10,
  maxPresentationSlides: 10,
  maxDocumentVisuals: 20,
  maxDocumentVisualBytes: 1_000_000,
  minPdfTextChars: 1,
  pdfRenderWidthPx: 600,
  maxPdfRenderPixels: 1_000_000,
  maxTextChars: 100_000,
  maxUnitChars: 8_000,
  maxSpreadsheetSheets: 10,
  maxSpreadsheetRows: 1_000,
  maxSpreadsheetColumns: 100,
  maxSpreadsheetCells: 10_000,
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function normalize(data: Buffer, name: string, overrides: Partial<FinanceDocumentParseLimits> = {}) {
  return await normalizeFinanceDocument(data, name, sha256(data), { ...limits, ...overrides }, 123)
}

function zip(entries: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value]),
  )))
}

function docx(paragraphs: string[], image = false): Buffer {
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${image ? '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage"/></w:drawing></w:r></w:p>' : ''}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${image ? '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/invoice.png"/>' : ''}</Relationships>`,
    ...image ? { 'word/media/invoice.png': PNG_1X1 } : {},
  })
}

function xlsx(image = false): Buffer {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="凭证" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>科目</t></is></c><c r="B1" t="inlineStr"><is><t>金额</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>管理费用</t></is></c><c r="B2"><v>123.45</v></c></row></sheetData>${image ? '<drawing r:id="rIdDrawing"/>' : ''}</worksheet>`,
    ...image ? {
      'xl/worksheets/_rels/sheet1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      'xl/drawings/drawing1.xml': '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
      'xl/drawings/_rels/drawing1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/receipt.png"/></Relationships>',
      'xl/media/receipt.png': PNG_1X1,
    } : {},
  })
}

function slide(paragraphs: string[], imageRelationshipId?: string): string {
  const body = paragraphs.map(text => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')
  const image = imageRelationshipId === undefined
    ? ''
    : `<p:pic><p:blipFill><a:blip r:embed="${imageRelationshipId}"/></p:blipFill></p:pic>`
  return `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp>${image}</p:spTree></p:cSld></p:sld>`
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

function pptx(): Buffer {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide(['第二张', '应收账款：88.00元']),
    'ppt/slides/slide2.xml': slide(['月度经营报告', '营业收入 &amp; 税额'], 'rId4'),
    'ppt/slides/_rels/slide2.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': slide(['备注：重点核对税率']),
    'ppt/media/image1.png': PNG_1X1,
  })
}

function imageOnlyPptx(): Buffer {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide([], 'rIdImage'),
    'ppt/slides/_rels/slide1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cover.png"/></Relationships>',
    'ppt/media/cover.png': PNG_1X1,
  })
}

function pdf(text?: string): Buffer {
  const stream = text === undefined ? '' : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output, 'ascii')
}

function pdfWithImage(text?: string): Buffer {
  const content = [
    'q 16 0 0 16 72 700 cm /Im0 Do Q',
    ...text === undefined ? [] : [`BT /F1 12 Tf 72 680 Td (${text}) Tj ET`],
  ].join('\n')
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', 'ascii'),
    Buffer.concat([
      Buffer.from('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n', 'ascii'),
      Buffer.from([0xFF, 0x00, 0x00]),
      Buffer.from('\nendstream', 'ascii'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii'),
    Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, 'ascii'),
  ]
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')]
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).byteLength)
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii'))
  })
  const xref = Buffer.concat(chunks).byteLength
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, 'ascii'))
  chunks.push(Buffer.from(offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''), 'ascii'))
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'ascii'))
  return Buffer.concat(chunks)
}

function digitalInvoiceXml(): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:inv="http://xbrl.mof.gov.cn/taxonomy/2023-12-31/inv">
  <inv:UniqueCodeOfInvoice>24442000000123456789</inv:UniqueCodeOfInvoice>
  <inv:DateOfIssue>2025-08-29</inv:DateOfIssue>
  <inv:NameOfPurchaser>瑞华云数豆科技有限公司</inv:NameOfPurchaser>
  <inv:NameOfSeller>腾讯云计算（北京）有限责任公司</inv:NameOfSeller>
  <inv:TotalAmountExcludingTax>100.00</inv:TotalAmountExcludingTax>
  <inv:TotalTaxAmount>6.00</inv:TotalTaxAmount>
  <inv:TaxIncludedAmountInFigures>106.00</inv:TaxIncludedAmountInFigures>
</xbrli:xbrl>`, 'utf8')
}

function digitalInvoiceOfd(): Buffer {
  return zip({
    'OFD.xml': '<?xml version="1.0"?><ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016"><ofd:DocBody><ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>',
    'Doc_0/Document.xml': '<?xml version="1.0"?><ofd:Document xmlns:ofd="http://www.ofdspec.org/2016"><ofd:DocumentRes>Res/DocumentRes.xml</ofd:DocumentRes><ofd:Pages><ofd:Page BaseLoc="Pages/Page_0/Content.xml"/></ofd:Pages></ofd:Document>',
    'Doc_0/Res/DocumentRes.xml': '<?xml version="1.0"?><ofd:Res xmlns:ofd="http://www.ofdspec.org/2016"><ofd:MultiMedias><ofd:MultiMedia ID="1" Type="Image"><ofd:MediaFile>invoice.png</ofd:MediaFile></ofd:MultiMedia></ofd:MultiMedias></ofd:Res>',
    'Doc_0/Pages/Page_0/Content.xml': '<?xml version="1.0"?><ofd:Page xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Content><ofd:Layer><ofd:TextObject><ofd:TextCode>数电发票</ofd:TextCode><ofd:TextCode>发票号码：24442000000123456789</ofd:TextCode><ofd:TextCode>价税合计：106.00元</ofd:TextCode></ofd:TextObject><ofd:ImageObject ResourceID="1"/></ofd:Layer></ofd:Content></ofd:Page>',
    'Doc_0/Res/invoice.png': PNG_1X1,
    'Doc_0/Attachments/invoice.xbrl': digitalInvoiceXml(),
  })
}

describe('Finance document parsing', () => {
  it('selects only the supported file families by extension', () => {
    expect(financeDocumentKindFromName('凭证.XLSX')).toBe('xlsx')
    expect(financeDocumentKindFromName('经营报告.PPTX')).toBe('pptx')
    expect(financeDocumentKindFromName('数电发票.XML')).toBe('xml')
    expect(financeDocumentKindFromName('数电发票.OFD')).toBe('ofd')
    expect(financeDocumentKindFromName('扫描件.png')).toBe('image')
    expect(financeDocumentKindFromName('旧版.xls')).toBe('unsupported')
    expect(financeDocumentKindFromName('旧版.ppt')).toBe('unsupported')
  })

  it('normalizes UTF-8 text and CSV with source locators', async () => {
    const text = await normalize(Buffer.from('第一行\n第二行'), '说明.txt')
    expect(text).toMatchObject({ status: 'parsed', kind: 'txt', normalizedAt: 123 })
    expect(text.units[0]).toMatchObject({ locator: '第1-2行', text: '第一行\n第二行' })

    const csv = await normalize(Buffer.from('科目,金额\n管理费用,123.45'), '明细.csv')
    expect(csv).toMatchObject({ status: 'parsed', kind: 'csv', summary: { rowCount: 2 } })
    expect(csv.units[1]).toMatchObject({ kind: 'row', locator: '第2行', text: '管理费用\t123.45' })
  })

  it('extracts DOCX paragraphs without Office', async () => {
    const document = await normalize(docx(['客户名称：数豆科技', '本期费用：123.45元']), '客户资料.docx')
    expect(document).toMatchObject({ status: 'parsed', kind: 'docx' })
    expect(document.units.map(unit => unit.text).join('\n')).toContain('客户名称：数豆科技')
    expect(document.units.map(unit => unit.locator)).toContain('第2段')
  })

  it('retains DOCX embedded pictures for native visual reading', async () => {
    const document = await normalize(docx(['客户资料'], true), '客户资料.docx')

    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'docx',
      summary: { visualCount: 1 },
      visuals: [{
        index: 0,
        sourceKey: 'word/media/invoice.png',
        mediaType: 'image/png',
        bytes: PNG_1X1.byteLength,
        locator: 'Word 内嵌图片 1',
      }],
    })
    expect(document.warnings).toContain('docx-embedded-images-available:1')

    const limited = await normalize(docx(['客户资料'], true), '客户资料.docx', {
      maxDocumentVisualBytes: PNG_1X1.byteLength - 1,
    })
    expect(limited.summary.visualCount).toBe(0)
    expect(limited.warnings).toContain('docx-embedded-images-truncated:1')
  })

  it('extracts XLSX sheets and rows without Excel', async () => {
    const document = await normalize(xlsx(), '凭证.xlsx')
    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'xlsx',
      summary: { sheetNames: ['凭证'], rowCount: 2 },
    })
    expect(document.units[1]).toMatchObject({
      kind: 'row',
      locator: '工作表“凭证”第2行',
      text: '管理费用\t123.45',
    })
    expect(document.warnings).toContain('xlsx-formulas-not-evaluated')
  })

  it('maps XLSX embedded pictures to their worksheet anchor', async () => {
    const document = await normalize(xlsx(true), '凭证.xlsx')

    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'xlsx',
      summary: { visualCount: 1 },
      visuals: [{
        sourceKey: 'xl/media/receipt.png',
        mediaType: 'image/png',
        bytes: PNG_1X1.byteLength,
        locator: '工作表“凭证”单元格 B3 附近',
      }],
    })
    expect(document.warnings).toContain('xlsx-embedded-images-available:1')
  })

  it('extracts PPTX slides in presentation order with speaker notes', async () => {
    const document = await normalize(pptx(), '月度报告.pptx')
    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'pptx',
      summary: { slideCount: 2, visualCount: 1 },
    })
    expect(document.visuals).toEqual([{
      index: 0,
      sourceKey: 'ppt/media/image1.png',
      mediaType: 'image/png',
      bytes: PNG_1X1.byteLength,
      locator: '幻灯片 1',
    }])
    expect(document.units[0]).toMatchObject({
      kind: 'text',
      locator: '第1张幻灯片',
    })
    expect(document.units[0]?.text).toContain('月度经营报告\n营业收入 & 税额')
    expect(document.units[0]?.text).toContain('演讲者备注：\n备注：重点核对税率')
    expect(document.units[1]).toMatchObject({
      locator: '第2张幻灯片',
      text: '第二张\n应收账款：88.00元',
    })
    expect(document.warnings).toContain('pptx-non-text-content-not-extracted')

    const limited = await normalize(pptx(), '月度报告.pptx', { maxPresentationSlides: 1 })
    expect(limited).toMatchObject({
      status: 'failed',
      kind: 'pptx',
      failureCode: 'pptx-slide-limit-exceeded',
    })
  })

  it('retains slide-referenced raster images for native visual reading', async () => {
    const document = await normalize(imageOnlyPptx(), '图片演示文稿.pptx')

    expect(document).toMatchObject({
      status: 'vision-required',
      kind: 'pptx',
      summary: { slideCount: 1, visualCount: 1 },
      visuals: [{
        sourceKey: 'ppt/media/cover.png',
        mediaType: 'image/png',
        locator: '幻灯片 1',
      }],
    })
    expect(document.warnings).toContain('pptx-text-layer-missing')
    expect(document.warnings).toContain('pptx-embedded-images-available:1')

    const extracted = extractPptxVisuals(imageOnlyPptx(), ['ppt/media/cover.png'], PNG_1X1.byteLength)
    expect(extracted).toEqual([{
      archivePart: 'ppt/media/cover.png',
      mediaType: 'image/png',
      data: new Uint8Array(PNG_1X1),
    }])
    expect(() => extractPptxVisuals(imageOnlyPptx(), ['ppt/media/cover.png'], PNG_1X1.byteLength - 1))
      .toThrow(/pptx-visual-byte-limit-exceeded/u)
  })

  it('extracts PDF text by page and marks image-only PDF for vision or OCR', async () => {
    const document = await normalize(pdf('Invoice total 123.45'), 'invoice.pdf')
    expect(document).toMatchObject({ status: 'parsed', kind: 'pdf', summary: { pageCount: 1 } })
    expect(document.units[0]).toMatchObject({ locator: '第1页' })
    expect(document.units[0]?.text).toContain('Invoice total 123.45')

    const scanned = await normalize(pdf(), 'scan.pdf', { minPdfTextChars: 24 })
    expect(scanned).toMatchObject({
      status: 'vision-required',
      kind: 'pdf',
      summary: { pageCount: 1, visualCount: 1 },
      visuals: [{
        sourceKey: 'pdf:page:1:render:600',
        mediaType: 'image/png',
        locator: '第1页（完整页面）',
      }],
    })
    expect(scanned.warnings).toContain('pdf-text-layer-missing')
    expect(scanned.warnings).toContain('pdf-rendered-pages-available:1')
  })

  it('renders a complete PDF page when the text layer is missing', async () => {
    const document = await normalize(pdfWithImage(), 'scan.pdf', { minPdfTextChars: 24 })

    expect(document).toMatchObject({
      status: 'vision-required',
      kind: 'pdf',
      summary: { pageCount: 1, visualCount: 1 },
      visuals: [{
        sourceKey: 'pdf:page:1:render:600',
        mediaType: 'image/png',
        locator: '第1页（完整页面）',
      }],
    })
    expect(document.warnings).toContain('pdf-rendered-pages-available:1')
    expect(document.warnings).not.toContain('pdf-embedded-images-available:1')
  })

  it('retains PDF embedded pictures on pages with a usable text layer', async () => {
    const document = await normalize(pdfWithImage('Invoice total 123.45'), 'invoice.pdf')

    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'pdf',
      summary: { pageCount: 1, visualCount: 1 },
      visuals: [{
        sourceKey: 'pdf:page:1:image:1',
        mediaType: 'image/png',
        locator: '第1页内嵌图片1',
      }],
    })
    expect(document.warnings).toContain('pdf-embedded-images-available:1')
  })

  it('reports a bounded scanned-page fallback when the rendered page cannot be retained', async () => {
    const document = await normalize(pdfWithImage(), 'scan.pdf', {
      minPdfTextChars: 24,
      maxDocumentVisualBytes: 1,
    })

    expect(document).toMatchObject({
      status: 'vision-required',
      kind: 'pdf',
      summary: { pageCount: 1, visualCount: 0 },
    })
    expect(document.warnings).toContain('pdf-rendered-pages-truncated:1')
  })

  it('extracts official digital-invoice XML fields without claiming signature verification', async () => {
    const document = await normalize(digitalInvoiceXml(), '数电发票.xml')

    expect(document).toMatchObject({ status: 'parsed', kind: 'xml' })
    expect(document.units.map(unit => unit.text)).toEqual(expect.arrayContaining([
      '发票号码\t24442000000123456789',
      '购买方名称\t瑞华云数豆科技有限公司',
      '价税合计\t106.00',
    ]))
    expect(document.warnings).toContain('digital-invoice-xml-detected')
    expect(document.warnings).toContain('digital-invoice-signature-not-verified')

    const ordinaryXml = await normalize(Buffer.from('<root><name>普通配置</name></root>'), '普通配置.xml')
    expect(ordinaryXml).toMatchObject({
      status: 'unsupported',
      kind: 'xml',
      warnings: ['xml-not-recognized-as-digital-invoice'],
    })
  })

  it('extracts OFD invoice page text and embedded raster pictures', async () => {
    const document = await normalize(digitalInvoiceOfd(), '数电发票.ofd')

    expect(document).toMatchObject({
      status: 'parsed',
      kind: 'ofd',
      summary: { pageCount: 1, visualCount: 1 },
      visuals: [{
        sourceKey: 'Doc_0/Res/invoice.png',
        mediaType: 'image/png',
        bytes: PNG_1X1.byteLength,
      }],
    })
    expect(document.units[0]?.text).toContain('发票号码：24442000000123456789')
    expect(document.units.map(unit => unit.text)).toEqual(expect.arrayContaining([
      '发票号码\t24442000000123456789',
      '购买方名称\t瑞华云数豆科技有限公司',
      '价税合计\t106.00',
    ]))
    expect(document.warnings).toContain('digital-invoice-ofd-detected')
    expect(document.warnings).toContain('digital-invoice-signature-not-verified')
  })

  it('re-extracts retained PDF, Word, Excel, PowerPoint, and OFD pictures by exact key', async () => {
    const fixtures = [
      { data: pdfWithImage(), name: 'scan.pdf' },
      { data: docx(['客户资料'], true), name: '客户资料.docx' },
      { data: xlsx(true), name: '凭证.xlsx' },
      { data: imageOnlyPptx(), name: '图片演示文稿.pptx' },
      { data: digitalInvoiceOfd(), name: '数电发票.ofd' },
    ] as const

    for (const fixture of fixtures) {
      const document = await normalize(fixture.data, fixture.name, { minPdfTextChars: 24 })
      const visual = document.visuals[0]
      if (visual === undefined) throw new Error(`Expected a retained visual for ${fixture.name}`)
      if (document.kind === 'csv' || document.kind === 'txt' || document.kind === 'image' || document.kind === 'unsupported') {
        throw new Error(`Unexpected non-visual kind for ${fixture.name}`)
      }
      const [extracted] = await extractDocumentVisuals(fixture.data, {
        kind: document.kind,
        visualKeys: [visual.sourceKey],
        maxOutputBytes: 1_000_000,
      })
      expect(extracted).toMatchObject({ sourceKey: visual.sourceKey, mediaType: visual.mediaType })
      expect(extracted?.data.byteLength).toBe(visual.bytes)
    }
  })

  it('routes images to native vision and rejects unsupported formats explicitly', async () => {
    expect(await normalize(Buffer.from([0x89, 0x50, 0x4E, 0x47]), 'invoice.png')).toMatchObject({
      status: 'native-vision',
      warnings: ['use-native-vision'],
    })
    expect(await normalize(Buffer.from('legacy'), 'ledger.xls')).toMatchObject({
      status: 'unsupported',
      warnings: ['unsupported-document-format'],
    })
  })

  it('enforces deterministic text and spreadsheet limits', async () => {
    const text = await normalize(Buffer.from('1234567890'), 'limit.txt', { maxTextChars: 5, maxUnitChars: 5 })
    expect(text.summary.charCount).toBe(5)
    expect(text.warnings).toContain('content-truncated')

    const csv = await normalize(Buffer.from('a,b\nc,d'), 'limit.csv', { maxSpreadsheetRows: 1 })
    expect(csv.summary.rowCount).toBe(1)
    expect(csv.warnings).toContain('spreadsheet-rows-truncated')
  })
})
