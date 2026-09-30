---
description: "Shared deterministic local document normalization for Xiaojing sessions"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-finance-documents

XML 内容先通过 `fast-xml-validator` 检查语法，再交由 `fast-xml-parser` 解析；实体展开仍受解析器配置限制。

[English](README.md) | 中文

## 概述

该小兢 Host 能力为已上传的 PDF、DOCX、XLSX、PPTX、数电发票 XML、OFD、CSV 和文本文件提供同一套确定性本地解析核心。两个会话适配器在不复制解析逻辑的前提下分别授权来源：Finance 会话通过 `finance_document` 消费不可变 Finance 导入事件，Standard、Goal、Plan 等非 Finance 小兢会话通过 `document_reader` 消费持久化的人类上传记录。本包不修改 Agent Loop，也不增加第二个上传按钮。


## 目录

- [功能说明](#capabilities)
- [开发备注](#dev-note)

<a id="capabilities"></a>
## 来源授权与标准化

现有小兢上传按钮仍是唯一文件入口。Finance 客户上传由 `xiaojing-finance-domain` 提交到绑定客户的 `02-原始资料` 目录，并记录 `finance/file-imported`；Finance 咨询上传记录为 `finance/consultation-file-imported`。Finance 适配器只接受当前会话中的这些不可变记录，并维持客户或咨询会话隔离。

对于非 Finance 会话，普通适配器只扫描当前会话中由真人产生且已持久化的 `user/message` 事件。它只接受随包上传插件生成的精确上传引用行，要求真实来源仍位于小兢受保护上传目录下，并拒绝插件生成的文字、任意路径、符号链接、目录以及其他会话的上传。两个适配器都会在解析前核验普通文件状态和记录大小；经过授权但超过配置上限的文件会在 SHA-256 扫描和 Worker 接纳前返回 `file-too-large`，符合大小限制的文件仍须先通过 SHA-256 核验才能访问缓存。

支持格式会产生受限且带来源位置的结构单元：

- PDF 在存在文字时产生页单元，把每个文字不足的页面渲染成受限 PNG，并保留文字充分页面中的可解码栅格 XObject 及页位置；
- DOCX 产生段落单元，并保留正文引用的栅格图片；
- XLSX 产生工作表行单元，但不会执行公式，同时保留工作表绘图中的栅格图片及邻近单元格位置；
- PPTX 按声明顺序产生幻灯片单元，包含可提取的形状、表格文字和演讲者备注；
- 识别为数电发票的 XML 或 XBRL 产生带中文标签的发票字段；
- OFD 产生页单元、保留页面引用的栅格图片，并在存在内嵌数电发票 XML 或 XBRL 时输出结构字段；
- CSV 产生行单元；
- TXT 产生行号范围单元。

以图片方式上传的 PNG、JPEG、WebP 和 GIF 继续使用 DeepSeek 原生视觉路线。工具的 `visuals` 操作把渲染后的 PDF 页面或 PDF、DOCX、XLSX、PPTX、OFD 中保留的图片批次交给当前支持图片输入的模型，并保留每张图片的来源位置。因此，扫描型或混合型 PDF 会对文字层有效的页面使用确定性文字，对文字层缺失或稀疏的页面使用完整页面视觉输入。除此之外，图表、SmartArt、矢量图形、动画、视频和嵌入对象不会被栅格化或重建。本包不执行 OCR；渲染后的扫描页面由当前支持图片输入的模型理解。`.doc`、`.xls` 和 `.ppt` 等旧版 Office 格式会返回明确的不支持状态。

数电发票支持税务机关说明的 PDF、OFD 和 XML 交付格式。PDF 使用普通文字与图片路线；XML 只有在同时识别出发票号码、交易一方和金额字段时才会按发票处理；OFD 会读取页面文字与图片，并扫描包内可识别的 XML 或 XBRL 数电发票数据。这些操作只解析内容，不验证电子签名、不判定来源真实性、不查询发票状态，也不能替代官方发票查验服务。

解析器在一个串行 Worker 中执行，并设置运行时限和 V8 内存上限。单个文档默认上限为 100 MiB，与随包上传插件保持一致；文件大小、PDF 页数、演示文稿幻灯片数、文本、工作表、行、列、单元格、结构单元、模型单次读取、视觉图片数量和视觉图片字节数仍可由部署配置控制。完整生成配置见[配置目录](../../../docs/config-catalog.zh.md)。

## 工具与模式隔离

`document_reader` 只在小兢构建中全局注册，因此所有非 Finance 小兢预设都会获得相同的本地文档能力。它支持 `list`、`read` 和 `visuals`，且不接受文件系统路径。Finance 预设注册具有相同操作的 `finance_document`，并在该作用域内明确隐藏 `document_reader`。这样既只保留一套解析实现，又能防止普通适配器绕过 Finance 客户授权。

标准化内容只通过普通已记录工具结果进入模型，不会注入常驻系统提示词。文本和图片均采用分页或分批读取，执行 `visuals` 前还必须确认当前实际模型路线声明支持图片输入。

## 持久化与移除

标准化记录使用持久 schema 版本 `3` 和解析器版本 `4`，保存在 `$DSH_HOME/finance/documents/v3/normalizer-v4/<作用域哈希>/`。额外的解析器目录可以防止完整页面渲染上线前生成的旧记录压制扫描页视觉结果。既有解析器版本以及 `v1`、`v2` 缓存保持不变。原子写入、文件锁和由已核验内容哈希与格式生成的文件键保护每条记录。Finance 客户记录按客户身份隔离，Finance 咨询记录按咨询会话隔离，普通模式按会话身份隔离。缓存不保存 API Key、提示词、模型输出或源文件；损坏缓存会阻止初始化并保留原文件不变。

删除 `xiaojing-finance-documents` Host 配置行和 `xiaojing-document-reader` 消费端配置行即可移除普通模式文档读取；删除 Finance 预设中的 `finance-documents` 消费端即可移除 Finance 工具。上传、原始文件、客户档案、官方依据和官方 Harness profile 保持独立。

## 模型体验

### 共享确定性文档读取

#### 模型看到什么

非 Finance 小兢预设获得 `document_reader(action, document_id?, cursor?)`，Finance 获得 `finance_document(action, document_id?, cursor?)`。`list` 只返回当前会话授权的文档与解析状态，`read` 返回带来源位置的受限文本单元，`visuals` 返回带来源位置的受限文档图片批次。两个工具都会要求模型停止反复尝试 Shell、Python、Office、本地文件路径或临时转换器。

#### Token 影响

只有模型明确读取的文本单元或视觉批次会进入当前会话，不会把完整标准化语料注入无关轮次或其他会话。

#### KV Cache 影响

工具结果随所选文档和游标变化，位于稳定提示词前缀之后。

## 已知限制与后续工作

- 本包提取来源文字、已保存单元格值、保留的栅格图片和可识别的数电发票字段；不推导会计分录、不判断税务处理，也不完成语义审阅。
- 数电发票解析不验证签名、真实性、发票状态、抵扣状态或入账状态。
- 本包只渲染文字不足的完整 PDF 页面；不渲染完整 OFD 或 Office 页面，也不捆绑 OCR、ONNX、Python、Microsoft Office 或外部 OCR 服务。
- DOCX 图片范围限于正文引用的栅格图片；页眉、页脚、复杂版式、嵌入对象、修订意图、宏、图表和受保护内容不会被重建。
- XLSX 公式不会执行，只保留工作表绘图中的栅格图片；视觉布局、隐藏状态、宏、图表和嵌入对象需要单独处理。
- PPTX 视觉检查只覆盖幻灯片引用的 PNG、JPEG、WebP 和 GIF；图表、SmartArt、矢量图、媒体、切换效果和嵌入对象仍需结合原文件或未来渲染器。
- 加密、损坏、超过安全上限或不支持的文件会明确失败，不进入临时工具反复试错流程。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件：注册表和所属服务直接维护这些关系，本包没有需要交叉核对的独立观测。
