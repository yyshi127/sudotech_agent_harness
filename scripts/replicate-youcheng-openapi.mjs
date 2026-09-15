import { mkdir, writeFile } from 'node:fs/promises';

const shareId = '7YX0lXxR';
const baseUrl = 'https://yiqbopenapi.superboss.cc';

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function treePath(node, nodesById) {
  const names = [];
  let current = node;
  while (current?.parentId) {
    const parent = nodesById.get(current.parentId);
    if (!parent) break;
    names.unshift(parent.name);
    current = parent;
  }
  return names;
}

const menuResponse = await getJson(`/share/menu?id=${shareId}`);
if (String(menuResponse.code) !== '0' || !Array.isArray(menuResponse.data)) {
  throw new Error(`Unable to read menu: ${menuResponse.msg ?? 'unknown error'}`);
}

const nodes = menuResponse.data;
const nodesById = new Map(nodes.map((node) => [node.id, node]));
const leaves = nodes.filter((node) => node.isFolder === 0);
const documents = [];
const failures = [];

for (const [index, node] of leaves.entries()) {
  try {
    const response = await getJson(`/doc/view?id=${encodeURIComponent(node.id)}`);
    if (String(response.code) !== '0' || !response.data) {
      throw new Error(response.msg ?? 'empty document');
    }
    documents.push({
      menu: node,
      path: treePath(node, nodesById),
      document: response.data,
    });
  } catch (error) {
    failures.push({ id: node.id, name: node.name, error: String(error) });
  }
  process.stdout.write(`\rRead ${index + 1}/${leaves.length}`);
}
process.stdout.write('\n');

const outputDir = 'docs/integrations';
await mkdir(outputDir, { recursive: true });
await writeFile(
  `${outputDir}/youcheng-openapi-replica.json`,
  `${JSON.stringify({ shareId, baseUrl, nodeCount: nodes.length, leafCount: leaves.length, documents, failures }, null, 2)}\n`,
  'utf8',
);

const lines = [
  '# 有成费控 OPENAPI 本地镜像',
  '',
  `- 来源：${baseUrl}/#/share/${shareId}`,
  `- 抓取时间：${new Date().toISOString()}`,
  `- 目录节点：${nodes.length}`,
  `- 具体接口：${leaves.length}`,
  `- 成功读取：${documents.length}`,
  `- 读取失败：${failures.length}`,
  '',
  '> 本文件是接口文档的本地只读镜像。请求示例、响应示例和说明按源文档保存；HTML 说明同时保留纯文本版本。未在此镜像中执行任何有成业务请求。',
  '',
];

for (const [index, item] of documents.entries()) {
  const doc = item.document;
  lines.push(`## ${index + 1}. ${item.path.join(' / ')} / ${item.menu.name}`);
  lines.push('');
  lines.push(`- 文档 ID：\`${item.menu.id}\``);
  lines.push(`- 方法：\`${doc.httpMethod || item.menu.httpMethod || ''}\``);
  lines.push(`- URL：\`${doc.url || item.menu.url || ''}\``);
  lines.push(`- 创建时间：${doc.gmtCreate || item.menu.gmtCreate || ''}`);
  lines.push(`- 最后更新时间：${doc.gmtModified || item.menu.gmtModified || ''}`);
  if (doc.debugEnvs?.length) {
    lines.push('- 调试环境：');
    for (const env of doc.debugEnvs) lines.push(`  - ${env.name}: ${env.url}`);
  }
  const description = stripHtml(doc.description);
  if (description) lines.push(`\n### 说明\n\n${description}`);
  for (const [label, value] of [
    ['请求参数', doc.requestParams],
    ['请求示例', doc.requestExample],
    ['响应参数', doc.responseParams],
    ['响应示例', doc.responseExample],
    ['错误码', doc.errorCode],
  ]) {
    if (value == null || value === '') continue;
    lines.push(`\n### ${label}\n\n\`\`\`json\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n\`\`\``);
  }
  lines.push('');
}

if (failures.length) {
  lines.push('## 读取失败的接口');
  lines.push('');
  for (const failure of failures) lines.push(`- ${failure.id} / ${failure.name}：${failure.error}`);
  lines.push('');
}

await writeFile(`${outputDir}/youcheng-openapi-replica.source.txt`, `${lines.join('\n')}\n`, 'utf8');
console.log(`Saved ${documents.length}/${leaves.length} documents; failures=${failures.length}`);
