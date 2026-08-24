const status = document.querySelector('#status')
const form = document.querySelector('#pairing')
const code = document.querySelector('#code')

function render(state) {
  const labels = {
    connected: '已连接小兢会计，可以接管个人 Edge 标签页。',
    'pairing-required': '尚未配对。请先在小兢会计设置页生成配对码。',
    connecting: '正在查找本机小兢会计…',
    disconnected: '未找到正在运行的小兢会计，请先启动应用。',
    incompatible: '扩展与小兢会计版本不兼容，请更新扩展。',
    error: state.error || '连接失败，请稍后重试。',
  }
  status.textContent = labels[state.state] || labels.connecting
  form.hidden = state.state === 'connected' || state.state === 'incompatible'
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'status' })
  render(state)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const value = code.value.trim().toUpperCase()
  if (!/^[A-Z2-9]{8}$/.test(value)) {
    status.textContent = '请输入完整的 8 位配对码。'
    return
  }
  const result = await chrome.runtime.sendMessage({ type: 'pair', code: value })
  render(result)
})

void refresh()
