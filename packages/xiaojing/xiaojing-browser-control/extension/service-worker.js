const PROTOCOL = 1
const PORTS = Array.from({ length: 10 }, (_value, index) => 53170 + index)
const ATTACHED = new Set()
const ACTIVE_REQUESTS = new Map()
let socket
let reconnectTimer
let state = { state: 'connecting' }
let authorized = false
let helloNonce
let helloSecret

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function randomNonce() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function handshakeProof(secret, participant, nonce) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${participant}:${nonce}`))))
}

function publish(next) {
  state = next
  void chrome.runtime.sendMessage({ type: 'state', state: next }).catch(() => undefined)
}

async function storedSecret() {
  return (await chrome.storage.local.get('secret')).secret
}

function send(value) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('host disconnected')
  socket.send(JSON.stringify(value))
}

function connect() {
  clearTimeout(reconnectTimer)
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  publish({ state: 'connecting' })
  probe(0)
}

function probe(index) {
  if (index >= PORTS.length) {
    publish({ state: 'disconnected' })
    reconnectTimer = setTimeout(connect, 2000)
    return
  }
  const candidate = new WebSocket(`ws://127.0.0.1:${PORTS[index]}`)
  let opened = false
  let recognized = false
  const timeout = setTimeout(() => candidate.close(), 700)
  candidate.addEventListener('open', () => {
    void (async () => {
      opened = true
      clearTimeout(timeout)
      socket = candidate
      authorized = false
      const nonce = randomNonce()
      const secret = await storedSecret()
      if (socket !== candidate || candidate.readyState !== WebSocket.OPEN) return
      helloNonce = nonce
      helloSecret = secret
      candidate.send(JSON.stringify({
        type: 'hello',
        extensionId: chrome.runtime.id,
        protocol: PROTOCOL,
        version: chrome.runtime.getManifest().version,
        nonce,
        ...(secret ? { proof: await handshakeProof(secret, 'extension', nonce) } : {}),
      }))
    })().catch(() => { candidate.close() })
  })
  candidate.addEventListener('message', event => {
    void handleMessage(candidate, event.data, () => { recognized = true }).catch(() => { candidate.close() })
  })
  candidate.addEventListener('close', () => {
    clearTimeout(timeout)
    if (!opened || !recognized) {
      if (socket === candidate) socket = undefined
      authorized = false
      helloNonce = undefined
      helloSecret = undefined
      probe(index + 1)
      return
    }
    if (socket === candidate) socket = undefined
    authorized = false
    helloNonce = undefined
    helloSecret = undefined
    void detachAll()
    for (const controller of ACTIVE_REQUESTS.values()) controller.abort()
    ACTIVE_REQUESTS.clear()
    publish({ state: 'disconnected' })
    reconnectTimer = setTimeout(connect, 2000)
  })
  candidate.addEventListener('error', () => undefined)
}

async function handleMessage(candidate, raw, markRecognized) {
  const message = JSON.parse(raw)
  if (message.type === 'hello-result') {
    if (message.state === 'connected') {
      if (!helloSecret || !helloNonce || typeof message.hostProof !== 'string'
        || message.hostProof !== await handshakeProof(helloSecret, 'host', helloNonce)) {
        throw new Error('host authentication failed')
      }
      markRecognized()
      authorized = true
      publish({ state: 'connected' })
    } else if (message.state === 'incompatible') {
      markRecognized()
      authorized = false
      publish({ state: 'incompatible' })
    } else {
      markRecognized()
      authorized = false
      publish({ state: 'pairing-required' })
    }
    return
  }
  if (message.type === 'pair-result') {
    if (message.ok === true && typeof message.secret === 'string') {
      await chrome.storage.local.set({ secret: message.secret })
      helloSecret = message.secret
      authorized = true
      publish({ state: 'connected' })
    } else {
      publish({ state: 'pairing-required', error: message.error === 'pairing-expired'
        ? '配对码已过期，请在小兢会计中重新生成。'
        : '配对码不正确。' })
    }
    return
  }
  if (message.type === 'cancel' && typeof message.id === 'string') {
    if (candidate !== socket || !authorized) throw new Error('host is not authorized')
    ACTIVE_REQUESTS.get(message.id)?.abort()
    return
  }
  if (message.type !== 'request' || typeof message.id !== 'string' || typeof message.method !== 'string') {
    throw new Error('invalid host message')
  }
  if (candidate !== socket || !authorized) throw new Error('host is not authorized')
  const controller = new AbortController()
  ACTIVE_REQUESTS.set(message.id, controller)
  try {
    const value = await dispatch(message.method, message.payload, controller.signal)
    if (controller.signal.aborted) throw new Error('browser operation cancelled')
    if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({ type: 'response', id: message.id, ok: true, value }))
  } catch (error) {
    if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({
      type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error),
    }))
  } finally {
    ACTIVE_REQUESTS.delete(message.id)
  }
}

function assertObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid command payload')
  return value
}

function normalUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

async function normalTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (tab.incognito || !normalUrl(tab.url)) throw new Error('only normal HTTP and HTTPS tabs can be controlled')
  return tab
}

function tabRow(tab) {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.windowId) || !normalUrl(tab.url)) return undefined
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || '',
    active: tab.active === true,
    ...(Number.isInteger(tab.openerTabId) ? { openerTabId: tab.openerTabId } : {}),
  }
}

async function attach(tabId) {
  await normalTab(tabId)
  if (ATTACHED.has(tabId)) return
  await chrome.debugger.attach({ tabId }, '1.3')
  ATTACHED.add(tabId)
}

async function detach(tabId) {
  if (!ATTACHED.delete(tabId)) return
  await chrome.debugger.detach({ tabId }).catch(() => undefined)
}

async function detachAll() {
  const tabIds = [...ATTACHED]
  ATTACHED.clear()
  await Promise.allSettled(tabIds.map(tabId => chrome.debugger.detach({ tabId })))
}

async function dispatch(method, rawPayload, signal) {
  const payload = assertObject(rawPayload)
  if (signal.aborted) throw new Error('browser operation cancelled')
  if (method === 'tabs') {
    const tabs = await chrome.tabs.query({})
    return tabs.filter(tab => tab.incognito !== true).map(tabRow).filter(Boolean)
  }
  if (method === 'open') {
    if (!normalUrl(payload.url) || !['reuse', 'new_window'].includes(payload.disposition)) throw new Error('invalid open request')
    const tab = payload.disposition === 'new_window'
      ? (await chrome.windows.create({ url: payload.url, focused: true })).tabs?.[0]
      : await chrome.tabs.create({ url: payload.url, active: false })
    const row = tab && tabRow(tab)
    if (!row) throw new Error('Edge did not create a controllable tab')
    return row
  }
  if (!Number.isInteger(payload.tabId)) throw new Error('invalid tab id')
  const tabId = payload.tabId
  if (method === 'attach') return await attach(tabId)
  if (method === 'detach') return await detach(tabId)
  if (method === 'close') {
    await detach(tabId)
    await chrome.tabs.remove(tabId)
    return null
  }
  if (method === 'show') {
    const tab = await normalTab(tabId)
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.update(tabId, { active: true })
    return null
  }
  if (!ATTACHED.has(tabId)) throw new Error('personal Edge tab is not attached for this task')
  if (method === 'observe') return await observe(tabId, payload.maxTargets, payload.maxTextChars)
  if (method === 'act') return await act(tabId, assertObject(payload.command), signal)
  throw new Error(`unknown command ${method}`)
}

function scanFrame(maxTargets, maxTextChars) {
  const normalize = (value, limit) => (value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const pointerControl = element => {
    const tag = element.tagName.toLowerCase()
    if (!['div', 'span', 'li'].includes(tag)) return false
    const text = normalize(element.innerText || element.textContent, 161)
    if (!text || text.length > 160 || getComputedStyle(element).cursor !== 'pointer') return false
    const parent = element.parentElement
    return !parent || getComputedStyle(parent).cursor !== 'pointer'
      || normalize(parent.innerText || parent.textContent, 161) !== text
  }
  const roleOf = element => {
    const explicit = normalize(element.getAttribute('role'), 40)
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag !== 'input') return pointerControl(element) ? 'button' : tag
    const type = element.type.toLowerCase()
    if (type === 'checkbox' || type === 'radio') return type
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
    if (type === 'file') return 'file'
    return 'textbox'
  }
  const nameOf = element => {
    const labels = element.labels ? [...element.labels].map(label => label.textContent || '').join(' ') : ''
    let labelled = ''
    for (const id of (element.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      labelled += ` ${document.getElementById(id)?.textContent || ''}`
    }
    for (const candidate of [element.getAttribute('aria-label'), labelled, labels, element.alt, element.title,
      element.placeholder, element.innerText, element.textContent]) {
      const value = normalize(candidate, 160)
      if (value) return value
    }
    return ''
  }
  const contextOf = element => {
    const rows = [
      ['dialog', element.closest('dialog,[role="dialog"],[role="alertdialog"]')],
      ['row', element.closest('tr,[role="row"]')],
      ['form', element.closest('form')],
      ['region', element.closest('section,[role="region"],[role="group"]')],
    ]
    const seen = new Set()
    const parts = []
    for (const [kind, container] of rows) {
      if (!container || seen.has(container)) continue
      seen.add(container)
      const heading = container.querySelector('h1,h2,h3,h4,h5,h6,legend,[aria-label]')
      const text = normalize(container.getAttribute('aria-label') || heading?.getAttribute('aria-label')
        || heading?.textContent || container.textContent, kind === 'row' ? 120 : 80)
      if (text) parts.push(`${kind}: ${text}`)
    }
    return parts.join(' | ').slice(0, 240)
  }
  const isInteractive = element => {
    const tag = element.tagName.toLowerCase()
    const role = normalize(element.getAttribute('role'), 40)
    return ['button', 'textarea', 'select', 'input'].includes(tag)
      || (tag === 'a' && element.hasAttribute('href')) || element.isContentEditable
      || ['button', 'link', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'option', 'switch'].includes(role)
      || pointerControl(element)
  }
  const nodes = []
  const visit = root => {
    for (const element of root.querySelectorAll('*')) {
      if (isInteractive(element)) nodes.push(element)
      if (element.shadowRoot) visit(element.shadowRoot)
    }
  }
  visit(document)
  const ordinals = new Map()
  const targets = []
  for (const element of nodes) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0) continue
    const role = roleOf(element)
    const name = nameOf(element)
    const context = contextOf(element)
    const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : ''
    const key = JSON.stringify([role, name, context, inputType])
    const ordinal = ordinals.get(key) || 0
    ordinals.set(key, ordinal + 1)
    const actions = []
    if (inputType !== 'file') actions.push('click', 'hover')
    if ((element instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'password',
      'radio', 'range', 'reset', 'submit'].includes(inputType)) || element instanceof HTMLTextAreaElement
      || element.isContentEditable) actions.push('fill', 'type')
    if (element instanceof HTMLSelectElement) actions.push('select')
    if (inputType === 'checkbox') actions.push('check', 'uncheck')
    if (inputType === 'radio') actions.push('check')
    if (inputType === 'file') actions.push('upload')
    const value = inputType === 'password' ? undefined
      : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? normalize(element.value, 160) : undefined
    targets.push({ role, name, context, inputType, ordinal, actions,
      disabled: 'disabled' in element && Boolean(element.disabled),
      ...(value ? { value } : {}),
      ...(['checkbox', 'radio'].includes(inputType) ? { checked: Boolean(element.checked) } : {}) })
  }
  const rawText = document.body?.innerText || ''
  return { text: rawText.replace(/\r\n?/g, '\n').slice(0, maxTextChars), targets: targets.slice(0, maxTargets),
    targetCount: targets.length, textLength: rawText.length }
}

async function observe(tabId, maxTargets, maxTextChars) {
  if (!Number.isInteger(maxTargets) || !Number.isInteger(maxTextChars)) throw new Error('invalid observation bounds')
  const tab = await normalTab(tabId)
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scanFrame,
    args: [maxTargets, maxTextChars],
  })
  const targets = []
  const texts = []
  let targetCount = 0
  let textLength = 0
  for (const frame of frames) {
    if (!frame.result) continue
    targetCount += frame.result.targetCount
    textLength += frame.result.textLength
    if (frame.result.text) texts.push(frame.result.text)
    for (const target of frame.result.targets) {
      if (targets.length < maxTargets) targets.push({ ...target, frameId: frame.frameId })
    }
  }
  const text = texts.join('\n').slice(0, maxTextChars)
  return { url: tab.url, title: tab.title || '', text, targets,
    truncated: targetCount > maxTargets || textLength > maxTextChars }
}

async function operateTarget(command) {
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim()
  const pointerControl = element => {
    const tag = element.tagName.toLowerCase()
    if (!['div', 'span', 'li'].includes(tag)) return false
    const text = normalize(element.innerText || element.textContent).slice(0, 161)
    if (!text || text.length > 160 || getComputedStyle(element).cursor !== 'pointer') return false
    const parent = element.parentElement
    return !parent || getComputedStyle(parent).cursor !== 'pointer'
      || normalize(parent.innerText || parent.textContent).slice(0, 161) !== text
  }
  const roleOf = element => {
    const explicit = normalize(element.getAttribute('role'))
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag !== 'input') return pointerControl(element) ? 'button' : tag
    const type = element.type.toLowerCase()
    if (type === 'checkbox' || type === 'radio') return type
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
    if (type === 'file') return 'file'
    return 'textbox'
  }
  const nameOf = element => {
    const labels = element.labels ? [...element.labels].map(label => label.textContent || '').join(' ') : ''
    let labelled = ''
    for (const id of (element.getAttribute('aria-labelledby') || '').split(/\s+/)) labelled += ` ${document.getElementById(id)?.textContent || ''}`
    for (const candidate of [element.getAttribute('aria-label'), labelled, labels, element.alt, element.title,
      element.placeholder, element.innerText, element.textContent]) {
      const value = normalize(candidate).slice(0, 160)
      if (value) return value
    }
    return ''
  }
  const contextOf = element => {
    const parts = []
    for (const [kind, container] of [['dialog', element.closest('dialog,[role="dialog"],[role="alertdialog"]')],
      ['row', element.closest('tr,[role="row"]')], ['form', element.closest('form')],
      ['region', element.closest('section,[role="region"],[role="group"]')]]) {
      if (!container) continue
      const heading = container.querySelector('h1,h2,h3,h4,h5,h6,legend,[aria-label]')
      const text = normalize(container.getAttribute('aria-label') || heading?.getAttribute('aria-label')
        || heading?.textContent || container.textContent).slice(0, kind === 'row' ? 120 : 80)
      if (text) parts.push(`${kind}: ${text}`)
    }
    return [...new Set(parts)].join(' | ').slice(0, 240)
  }
  const locate = () => {
    const nodes = []
    const visit = root => {
      for (const element of root.querySelectorAll('*')) {
        const tag = element.tagName.toLowerCase()
        const role = normalize(element.getAttribute('role'))
        if (['button', 'textarea', 'select', 'input'].includes(tag) || (tag === 'a' && element.hasAttribute('href'))
          || element.isContentEditable || ['button', 'link', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem',
            'option', 'switch'].includes(role) || pointerControl(element)) nodes.push(element)
        if (element.shadowRoot) visit(element.shadowRoot)
      }
    }
    visit(document)
    const ordinals = new Map()
    let target
    for (const element of nodes) {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0) continue
      const role = roleOf(element)
      const name = nameOf(element)
      const context = contextOf(element)
      const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : ''
      const key = JSON.stringify([role, name, context, inputType])
      const ordinal = ordinals.get(key) || 0
      ordinals.set(key, ordinal + 1)
      const exact = command.descriptor && role === command.descriptor.role && name === command.descriptor.name
        && context === command.descriptor.context && inputType === command.descriptor.inputType
        && ordinal === command.descriptor.ordinal
      const semantic = command.semantic && (command.semantic.role === undefined || command.semantic.role === role)
        && (command.semantic.name === undefined || command.semantic.name === name)
        && (command.semantic.context === undefined || command.semantic.context === context)
      if (exact || semantic) {
        if (target && semantic && !command.descriptor) return { error: 'semantic target is ambiguous' }
        target = element
        if (exact) break
      }
    }
    return { target }
  }
  if (command.action === 'locate') {
    const located = locate()
    return located.error ? located : { found: Boolean(located.target) }
  }
  if (command.action === 'locate_wait') {
    const immediate = locate()
    if (immediate.error || immediate.target) return immediate.error ? immediate : { found: true }
    const root = document.documentElement
    if (!root) return { found: false }
    return await new Promise(resolve => {
      const finish = result => {
        clearTimeout(timer)
        observer.disconnect()
        resolve(result)
      }
      const check = () => {
        const located = locate()
        if (located.error) finish(located)
        else if (located.target) finish({ found: true })
      }
      const observer = new MutationObserver(check)
      const timer = setTimeout(() => { finish({ found: false }) }, command.timeoutMs)
      observer.observe(root, { attributes: true, childList: true, subtree: true })
      queueMicrotask(check)
    })
  }
  const located = locate()
  if (located.error) return located
  const target = located.target
  if (!target && !['scroll', 'press', 'wait_for'].includes(command.action)) return { error: 'target changed; observe again' }
  if (command.action === 'click') target.click()
  else if (command.action === 'focus') {
    if (!target) return { error: 'target changed; observe again' }
    target.focus({ preventScroll: true })
    if (target.getRootNode().activeElement !== target) return { error: 'target could not receive focus' }
  }
  else if (command.action === 'hover') {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, composed: true }))
  } else if (command.action === 'fill' || command.action === 'type') {
    const current = target.value ?? target.textContent ?? ''
    const value = command.action === 'type' ? current + (command.value || '') : (command.value || '')
    const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : target instanceof HTMLInputElement ? HTMLInputElement.prototype : undefined
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (setter) setter.call(target, value)
    else target.textContent = value
    target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: command.value || '' }))
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    if ((target.value ?? target.textContent ?? '') !== value) return { error: 'field value did not persist' }
  } else if (command.action === 'select') {
    const option = [...target.options].find(row => row.label === command.value || row.value === command.value)
    if (!option) return { error: 'select option is missing' }
    target.value = option.value
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    if (target.value !== option.value) return { error: 'selected value did not persist' }
  } else if (command.action === 'check' || command.action === 'uncheck') {
    const expected = command.action === 'check'
    if (Boolean(target.checked) !== expected) target.click()
    if (Boolean(target.checked) !== expected) return { error: 'checked state did not persist' }
  } else if (command.action === 'upload') {
    const token = `xj-${crypto.randomUUID()}`
    target.setAttribute('data-xiaojing-upload-token', token)
    return { uploadToken: token }
  } else if (command.action === 'scroll') window.scrollBy({ top: command.deltaY || 640, behavior: 'instant' })
  return { value: target?.value, checked: target?.checked }
}

async function executeInFrame(tabId, frameId, command) {
  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: operateTarget, args: [command] })
  const result = results[0]?.result
  if (!result) throw new Error('target frame is unavailable')
  if (result.error) throw new Error(result.error)
  return result
}

async function targetFrames(tabId, command, timeoutMs, signal) {
  const frames = command.descriptor
    ? [{ frameId: command.descriptor.frameId }]
    : await chrome.webNavigation.getAllFrames({ tabId })
  if (!frames?.length) throw new Error('target page has no controllable frame')
  const locate = async action => await Promise.all(frames.map(async frame => ({
    frameId: frame.frameId,
    result: await executeInFrame(tabId, frame.frameId, { ...command, action, timeoutMs }),
  })))
  const select = rows => {
    const error = rows.find(row => row.result.error)?.result.error
    if (error) throw new Error(error)
    const found = rows.filter(row => row.result.found === true)
    if (found.length > 1) throw new Error('semantic target is ambiguous across frames')
    return found[0]?.frameId
  }
  let frameId = select(await locate('locate'))
  if (frameId !== undefined) return frameId
  const waits = frames.map(async frame => {
    const result = await executeInFrame(tabId, frame.frameId, { ...command, action: 'locate_wait', timeoutMs })
    if (result.error) throw new Error(result.error)
    if (result.found !== true) throw new Error('target did not appear in frame')
  })
  try {
    await abortable(Promise.any(waits), signal)
  } catch {
    if (signal.aborted) throw new Error('browser operation cancelled')
    throw new Error('semantic target did not appear before the timeout')
  }
  frameId = select(await locate('locate'))
  if (frameId === undefined) throw new Error('target changed before the action; observe again')
  return frameId
}

async function uploadFiles(tabId, token, paths) {
  await chrome.debugger.sendCommand({ tabId }, 'DOM.enable')
  const flattened = await chrome.debugger.sendCommand({ tabId }, 'DOM.getFlattenedDocument', { depth: -1, pierce: true })
  const node = flattened.nodes.find(candidate => {
    const attributes = candidate.attributes || []
    for (let index = 0; index < attributes.length; index += 2) {
      if (attributes[index] === 'data-xiaojing-upload-token' && attributes[index + 1] === token) return true
    }
    return false
  })
  if (!node) throw new Error('file input changed before upload')
  await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { files: paths, backendNodeId: node.backendNodeId })
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: marker => {
      document.querySelector(`[data-xiaojing-upload-token="${CSS.escape(marker)}"]`)
        ?.removeAttribute('data-xiaojing-upload-token')
    },
    args: [token],
  })
}

async function dispatchKey(tabId, key) {
  const parts = key.split('+')
  const value = parts.pop()
  let modifiers = 0
  for (const part of parts.map(row => row.toLowerCase())) {
    if (part === 'alt') modifiers |= 1
    else if (part === 'control' || part === 'ctrl') modifiers |= 2
    else if (part === 'meta') modifiers |= 4
    else if (part === 'shift') modifiers |= 8
  }
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', key: value, modifiers })
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: value, modifiers })
}

function waitForFrameText(expectedText, timeoutMs) {
  return new Promise(resolve => {
    const matches = () => (document.body?.innerText || '').includes(expectedText)
    if (matches()) {
      resolve(true)
      return
    }
    const root = document.documentElement
    if (!root) {
      resolve(false)
      return
    }
    let timer
    const observer = new MutationObserver(() => {
      if (!matches()) return
      clearTimeout(timer)
      observer.disconnect()
      resolve(true)
    })
    observer.observe(root, { childList: true, characterData: true, subtree: true })
    timer = setTimeout(() => {
      observer.disconnect()
      resolve(false)
    }, timeoutMs)
  })
}

async function abortable(promise, signal) {
  if (signal.aborted) throw new Error('browser operation cancelled')
  return await new Promise((resolve, reject) => {
    const aborted = () => { reject(new Error('browser operation cancelled')) }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', aborted) })
  })
}

async function waitForText(tabId, expectedText, timeoutMs, signal) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId })
  if (!frames?.length) throw new Error('target page has no readable frames')
  const attempts = frames.map(frame => chrome.scripting.executeScript({
    target: { tabId, frameIds: [frame.frameId] },
    func: waitForFrameText,
    args: [expectedText, timeoutMs],
  }).then(result => {
    if (result[0]?.result === true) return
    throw new Error('text not found in frame')
  }))
  try {
    await abortable(Promise.any(attempts), signal)
  } catch {
    if (signal.aborted) throw new Error('browser operation cancelled')
    throw new Error('wait_for text timed out')
  }
}

async function waitForUrl(tabId, expectedUrl, timeoutMs, signal) {
  const current = await chrome.tabs.get(tabId)
  if (current.url?.includes(expectedUrl)) return
  await new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(updated)
      reject(new Error('browser operation cancelled'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      chrome.tabs.onUpdated.removeListener(updated)
      reject(new Error('wait_for URL timed out'))
    }, timeoutMs)
    const updated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || !(changeInfo.url || tab.url)?.includes(expectedUrl)) return
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      chrome.tabs.onUpdated.removeListener(updated)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(updated)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

async function waitForPage(tabId, expectedUrl, expectedText, timeoutMs, signal) {
  if (!expectedUrl && !expectedText) throw new Error('wait_for needs expectedUrl or expectedText')
  const timeout = Math.min(Math.max(timeoutMs || 5000, 100), 120000)
  await Promise.all([
    expectedUrl ? waitForUrl(tabId, expectedUrl, timeout, signal) : Promise.resolve(),
    expectedText ? waitForText(tabId, expectedText, timeout, signal) : Promise.resolve(),
  ])
}

async function act(tabId, command, signal) {
  const allowed = ['click', 'fill', 'type', 'select', 'check', 'uncheck', 'hover', 'press', 'scroll', 'upload', 'wait_for']
  if (!allowed.includes(command.action)) throw new Error('unsupported semantic action')
  if (signal.aborted) throw new Error('browser operation cancelled')
  if (command.action === 'press') {
    if (command.descriptor || command.semantic) {
      const timeout = Math.min(Math.max(command.timeoutMs || 5000, 100), 120000)
      const frameId = await targetFrames(tabId, command, timeout, signal)
      await executeInFrame(tabId, frameId, { ...command, action: 'focus' })
    }
    await dispatchKey(tabId, command.key)
    return null
  }
  if (command.action === 'wait_for') {
    await waitForPage(tabId, command.expectedUrl, command.expectedText, command.timeoutMs, signal)
    return null
  }
  const timeout = Math.min(Math.max(command.timeoutMs || 5000, 100), 120000)
  const needsTarget = !['scroll'].includes(command.action) || command.descriptor || command.semantic
  const frameId = needsTarget ? await targetFrames(tabId, command, timeout, signal) : 0
  const result = await executeInFrame(tabId, frameId, command)
  if (command.action === 'upload') {
    if (!Array.isArray(command.paths) || !command.paths.length || !result.uploadToken) throw new Error('invalid upload request')
    await uploadFiles(tabId, result.uploadToken, command.paths)
  }
  if (command.expectedUrl || command.expectedText) {
    await waitForPage(tabId, command.expectedUrl, command.expectedText, command.timeoutMs, signal)
  }
  return null
}

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source.tabId)) ATTACHED.delete(source.tabId)
})

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'status') {
    respond(state)
    return false
  }
  if (message?.type === 'pair' && typeof message.code === 'string') {
    if (state.state !== 'pairing-required') {
      respond({ state: 'error', error: '请先等待扩展连接到正在运行的小兢会计。' })
      return false
    }
    try {
      send({ type: 'pair', code: message.code })
      respond({ state: 'connecting' })
    } catch (error) {
      respond({ state: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    return false
  }
  return false
})

chrome.alarms.create('xiaojing-heartbeat', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }))
  else connect()
})

connect()
