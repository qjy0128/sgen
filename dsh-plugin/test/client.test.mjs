import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let definition
const window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}
const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
let fetchHandler = async () => {
  throw new Error('未预期的网络请求')
}
vm.runInNewContext(source, { window, fetch: (...args) => fetchHandler(...args) })

let current
let SgenPage
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.flat() } }
  },
  useState(initial) {
    const context = current
    const index = context.index++
    if (context.live) {
      const key = `${context.path}:${index}`
      if (!context.live.values.has(key)) {
        context.live.values.set(key, typeof initial === 'function' ? initial() : initial)
      }
      const value = context.live.values.get(key)
      return [value, (next) => {
        const previous = context.live.values.get(key)
        context.live.values.set(key, typeof next === 'function' ? next(previous) : next)
        context.live.render()
      }]
    }
    const value = context.overrides && index in context.overrides ? context.overrides[index] : initial
    return [typeof value === 'function' ? value() : value, () => {}]
  },
  useEffect() {},
  useMemo(fn) {
    return fn()
  },
}
const client = definition.factory((name) => {
  assert.equal(name, 'react')
  return React
})
SgenPage = client.SgenPage

function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node.type === 'function') {
    const previous = current
    current = {
      index: 0,
      path: `${previous.path || 'root'}/${node.type.name}`,
      overrides: node.type === SgenPage ? current.pageOverrides : undefined,
      pageOverrides: current.pageOverrides,
      live: current.live,
    }
    const rendered = node.type(node.props)
    current = previous
    return expand(rendered)
  }
  return { ...node, props: { ...node.props, children: node.props.children.map(expand) } }
}

function render(state, updatedAt = new Date('2026-11-08T15:30:00Z'), tab = 'config', activeRuns = 0) {
  current = { pageOverrides: { 0: state, 1: false, 2: '', 3: 0, 4: 'all', 5: updatedAt, 6: tab, 7: activeRuns } }
  const tree = expand(React.createElement(SgenPage))
  current = undefined
  return tree
}

function renderComponent(component, props) {
  current = { pageOverrides: {} }
  const tree = expand(React.createElement(component, props))
  current = undefined
  return tree
}

function renderLive(state, { tab = 'artifacts', activeRuns = 0 } = {}) {
  const live = { values: new Map(), tree: null, render: null }
  const overrides = { 0: state, 1: false, 2: '', 3: 0, 4: 'all', 5: new Date('2026-11-08T15:30:00Z'), 6: tab, 7: activeRuns }
  for (const [index, value] of Object.entries(overrides)) live.values.set(`root/SgenPage:${index}`, value)
  live.render = () => {
    current = { live }
    live.tree = expand(React.createElement(SgenPage))
    current = undefined
    return live.tree
  }
  live.render()
  return {
    get tree() {
      return live.tree
    },
    setState(next) {
      live.values.set('root/SgenPage:0', next)
      live.render()
    },
  }
}

function findAll(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  for (const child of node.props?.children || []) findAll(child, predicate, found)
  return found
}

function findParent(node, target, parent = null) {
  if (!node || typeof node !== 'object') return undefined
  if (node === target) return parent
  for (const child of node.props?.children || []) {
    const found = findParent(child, target, node)
    if (found !== undefined) return found
  }
  return undefined
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children || [])
}

function stateFixture() {
  return {
    config_path: '/tmp/.sgen/config.json',
    providers: {
      sensenova: { keys: 1, base_url: 'https://sensenova.example.com/v1' },
      agnes: { keys: 1, base_url: 'https://agnes.example.com/v1', region: 'international' },
    },
    default_models: { image: 'sn-image-default', video: 'agnes-video-default' },
    models: [
      { id: 'sn-image-default', provider: 'sensenova', type: 'image', defaultSize: 'auto', sizeTiers: ['auto', '1K', '2K', '4K'] },
      { id: 'sn-image-alt', provider: 'sensenova', type: 'image' },
      { id: 'agnes-image-default', provider: 'agnes', type: 'image', sizeTiers: ['1K', '2K', '3K', '4K'] },
      { id: 'agnes-image-alt', provider: 'agnes', type: 'image' },
      { id: 'agnes-video-default', provider: 'agnes', type: 'video' },
      { id: 'agnes-video-alt', provider: 'agnes', type: 'video' },
    ],
    items: [],
  }
}

test('页面提供试验场、配置、产物三个 Tab', () => {
  const tree = render(stateFixture())
  const tablist = findAll(tree, (node) => node.props?.role === 'tablist' && node.props?.['aria-label'] === 'SGeN 功能')[0]
  assert.ok(tablist)
  const tabs = findAll(tablist, (node) => node.props?.role === 'tab')
  assert.deepEqual(tabs.map(textOf), ['试验场', '配置', '产物'])
  assert.deepEqual(tabs.map((node) => node.props['aria-selected']), [false, true, false])
  assert.deepEqual(tabs.map((node) => node.props.style.borderBottomColor), ['transparent', 'var(--dsw-alias-brand-primary)', 'transparent'])
})

test('切换 Tab 时试验场保持挂载，Tab 上显示生成中图标', () => {
  const tree = render(stateFixture(), new Date('2026-11-08T15:30:00Z'), 'config', 1)
  const form = findAll(tree, (node) => node.props?.['aria-label'] === 'SGeN 试验场')[0]
  assert.ok(form, '其他 Tab 下也应保留试验场组件')
  const wrapper = findAll(tree, (node) => node.props?.style?.display === 'none')[0]
  assert.ok(wrapper)
  const playgroundTab = findAll(tree, (node) => node.props?.role === 'tab' && textOf(node) === '试验场')[0]
  assert.ok(playgroundTab)
  assert.equal(findAll(playgroundTab, (node) => node.props?.['aria-label'] === '生成中').length, 1)
})

test('试验场包含提示词、模型、参数、参考图和生成按钮', () => {
  const tree = render(stateFixture(), new Date('2026-11-08T15:30:00Z'), 'playground')
  const form = findAll(tree, (node) => node.props?.['aria-label'] === 'SGeN 试验场')[0]
  assert.ok(form)
  assert.equal(findAll(form, (node) => node.type === 'textarea' && node.props.name === 'prompt').length, 1)
  const model = findAll(form, (node) => node.type === 'select' && node.props.name === 'model')[0]
  assert.ok(model)
  assert.equal(model.props.value, 'sn-image-default')
  assert.equal(findAll(form, (node) => node.type === 'input' && node.props.name === 'size').length, 1)
  assert.equal(findAll(form, (node) => node.type === 'input' && node.props.name === 'ratio').length, 1)
  assert.equal(findAll(form, (node) => node.type === 'input' && node.props.type === 'file').length, 1)
  assert.ok(findAll(form, (node) => node.type === 'button' && textOf(node) === '生成图片').length)
  assert.equal(findAll(form, (node) => node.type === 'button' && node.props['aria-label'] === '清空表单').length, 1)
  assert.equal(findAll(form, (node) => node.type === 'input' && node.props.type === 'password').length, 0)
})

test('两家服务商各自独立配置 Key，不再有 Base URL 或供应商选中按钮', () => {
  const tree = render(stateFixture())
  const snSection = findAll(tree, (node) => node.props?.['aria-label'] === '商汤 SenseNova 配置')[0]
  const agnesSection = findAll(tree, (node) => node.props?.['aria-label'] === 'Agnes 配置')[0]
  assert.ok(snSection)
  assert.ok(agnesSection)
  for (const section of [snSection, agnesSection]) {
    assert.match(textOf(section), /API Key（已配置 1 把）/)
    assert.equal(findAll(section, (node) => node.type === 'input' && node.props.type === 'password').length, 1)
  }
  const keys = findAll(tree, (node) => node.type === 'input' && node.props.type === 'password')
  assert.deepEqual(keys.map((node) => node.props.name), ['sensenova-api-key', 'agnes-api-key'])
  assert.equal(findAll(tree, (node) => node.type === 'input' && node.props.type === 'url').length, 0)
  assert.doesNotMatch(textOf(tree), /Base URL/)
  assert.equal(findAll(tree, (node) => node.props?.['aria-label'] === '当前编辑的服务商（单选）').length, 0)
})

test('模型按供应商分区列出，图片和视频分别单选', () => {
  const tree = render(stateFixture())
  const snSection = findAll(tree, (node) => node.props?.['aria-label'] === '商汤 SenseNova 配置')[0]
  const agnesSection = findAll(tree, (node) => node.props?.['aria-label'] === 'Agnes 配置')[0]
  assert.ok(snSection)
  assert.ok(agnesSection)
  assert.equal(findAll(snSection, (node) => node.type === 'input' && node.props.type === 'radio').length, 2)
  assert.equal(findAll(agnesSection, (node) => node.type === 'input' && node.props.type === 'radio').length, 4)

  const images = findAll(tree, (node) => node.type === 'input' && node.props.name === 'default-image-model')
  const videos = findAll(tree, (node) => node.type === 'input' && node.props.name === 'default-video-model')
  assert.equal(images.length, 4)
  assert.equal(videos.length, 2)
  assert.deepEqual(images.filter((node) => node.props.checked).map((node) => node.props.value), ['sn-image-default'])
  assert.deepEqual(videos.filter((node) => node.props.checked).map((node) => node.props.value), ['agnes-video-default'])
})

test('底部只读展示已保存的当前默认模型', () => {
  const tree = render(stateFixture())
  const current = findAll(tree, (node) => node.props?.['aria-label'] === '当前默认模型（只读）')[0]
  assert.ok(current)
  assert.match(textOf(current), /sn-image-default/)
  assert.match(textOf(current), /agnes-video-default/)
  assert.doesNotMatch(textOf(current), /sn-image-alt|agnes-video-alt/)
  assert.equal(findAll(current, (node) => node.type === 'input' || node.type === 'button').length, 0)
})

test('任务列表展示状态，最新完成项展开，其他项默认收起', () => {
  let toggled = ''
  const tree = renderComponent(client.TaskResults, {
    tasks: [
      { id: 'latest', kind: 'image', prompt: '最新完成', model: 'm1', status: 'completed', item: { id: 'latest-file', file: '/tmp/latest.png' } },
      { id: 'running', kind: 'image', prompt: '正在生成', model: 'm1', status: 'running' },
      { id: 'older', kind: 'image', prompt: '较早完成', model: 'm1', status: 'completed', item: { id: 'older-file', file: '/tmp/older.png' } },
    ],
    expandedId: 'latest',
    onToggle: (id) => { toggled = id },
    onDelete: () => {},
    onRetry: () => {},
  })
  assert.match(textOf(tree), /生成中/)
  assert.match(textOf(tree), /已完成/)
  assert.equal(findAll(tree, (node) => node.type === 'img').length, 1)
  assert.equal(findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '删除产物').length, 1)
  const older = findAll(tree, (node) => node.type === 'button' && textOf(node).includes('较早完成'))[0]
  assert.ok(older)
  older.props.onClick()
  assert.equal(toggled, 'older')
})

test('失败任务也能从试验场任务列表删除', () => {
  let deleted = ''
  const tree = renderComponent(client.TaskResults, {
    tasks: [{ id: 'failed-1', kind: 'image', prompt: '失败任务', model: 'm1', status: 'failed', error: '模拟失败' }],
    expandedId: 'failed-1',
    onToggle: () => {},
    onDelete: (task) => { deleted = task.id },
    onRetry: () => {},
  })
  const remove = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '删除任务')[0]
  assert.ok(remove, '失败任务应有删除入口')
  remove.props.onClick()
  assert.equal(deleted, 'failed-1')
})

test('产物页只显示试验场产物，并提供目录修改和删除入口', () => {
  const state = {
    ...stateFixture(),
    playground_dir: '/tmp/sgen',
    items: [
      { id: 'play', kind: 'image', source: 'playground', file: '/tmp/play.png', name: 'play.png', model: 'm1', prompt: '试验产物', created_at: '2026-11-10T01:00:00Z' },
      { id: 'agent', kind: 'image', source: 'agent', file: '/tmp/agent.png', name: 'agent.png', model: 'm1', prompt: 'Agent 产物', created_at: '2026-11-09T01:00:00Z' },
    ],
  }
  const tree = render(state, new Date('2026-11-08T15:30:00Z'), 'artifacts')
  assert.match(textOf(tree), /试验产物/)
  assert.doesNotMatch(textOf(tree), /Agent 产物/)
  const directory = findAll(tree, (node) => node.type === 'input' && node.props.name === 'playground_dir')[0]
  assert.ok(directory)
  assert.equal(directory.props.value, '/tmp/sgen')
  const form = findAll(tree, (node) => node.props?.['aria-label'] === '产物存放目录设置')[0]
  assert.equal(form.props.style.alignItems, 'flex-start')
  assert.ok(findAll(form, (node) => node.props?.style?.marginTop === 23).length)
  assert.ok(findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '删除产物').length)
})

test('点击主 Tab 和图片/视频筛选后，选中样式与内容同步切换', () => {
  const state = {
    ...stateFixture(),
    playground_dir: '/tmp/sgen',
    items: [
      { id: 'image', kind: 'image', source: 'playground', file: '/tmp/image.png', name: 'image.png', model: 'm1', prompt: '只有图片', created_at: '2026-11-10T01:00:00Z' },
      { id: 'video', kind: 'video', source: 'playground', file: '/tmp/video.mp4', name: 'video.mp4', model: 'm2', prompt: '只有视频', created_at: '2026-11-10T01:00:00Z' },
    ],
  }
  const live = renderLive(state)
  const click = (label) => {
    const button = findAll(live.tree, (node) => node.type === 'button' && textOf(node) === label)[0]
    assert.ok(button, `找不到按钮：${label}`)
    button.props.onClick()
  }

  const gallery = () => {
    const group = findAll(live.tree, (node) => node.props?.['aria-label'] === '作品筛选')[0]
    const parent = findParent(live.tree, group)
    assert.ok(parent)
    return parent
  }

  click('视频 1')
  let buttons = findAll(live.tree, (node) => node.type === 'button' && ['全部 2', '图片 1', '视频 1'].includes(textOf(node)))
  assert.deepEqual(buttons.map((node) => node.props.style.background), [
    'var(--dsw-alias-bg-layer-1)',
    'var(--dsw-alias-bg-layer-1)',
    'var(--dsw-alias-brand-primary)',
  ])
  assert.doesNotMatch(textOf(gallery()), /只有图片/)
  assert.match(textOf(gallery()), /只有视频/)

  click('图片 1')
  buttons = findAll(live.tree, (node) => node.type === 'button' && ['全部 2', '图片 1', '视频 1'].includes(textOf(node)))
  assert.deepEqual(buttons.map((node) => node.props.style.background), [
    'var(--dsw-alias-bg-layer-1)',
    'var(--dsw-alias-brand-primary)',
    'var(--dsw-alias-bg-layer-1)',
  ])
  assert.match(textOf(gallery()), /只有图片/)
  assert.doesNotMatch(textOf(gallery()), /只有视频/)

  click('配置')
  const tabs = findAll(live.tree, (node) => node.props?.role === 'tab')
  assert.deepEqual(tabs.map((node) => node.props['aria-selected']), [false, true, false])
  assert.deepEqual(tabs.map((node) => node.props.style.borderBottomColor), ['transparent', 'var(--dsw-alias-brand-primary)', 'transparent'])
})

test('试验场图片/视频切换会更新选中样式和生成类型', () => {
  const live = renderLive(stateFixture(), { tab: 'playground' })
  const video = findAll(live.tree, (node) => node.type === 'button' && textOf(node) === '视频')[0]
  assert.ok(video)
  video.props.onClick()
  const image = findAll(live.tree, (node) => node.type === 'button' && textOf(node) === '图片')[0]
  const activeVideo = findAll(live.tree, (node) => node.type === 'button' && textOf(node) === '视频')[0]
  assert.equal(image.props.style.background, 'var(--dsw-alias-bg-layer-1)')
  assert.equal(activeVideo.props.style.background, 'var(--dsw-alias-brand-primary)')
  assert.ok(findAll(live.tree, (node) => node.type === 'button' && textOf(node) === '生成视频').length)
})

test('从 Agnes 切回商汤时尺寸恢复该模型默认值 auto', () => {
  const live = renderLive(stateFixture(), { tab: 'playground' })
  const select = () => findAll(live.tree, (node) => node.type === 'select' && node.props.name === 'model')[0]
  const size = () => findAll(live.tree, (node) => node.type === 'input' && node.props.name === 'size')[0]

  select().props.onChange({ target: { value: 'agnes-image-default' } })
  size().props.onChange({ target: { value: '2K' } })
  assert.equal(size().props.value, '2K')
  select().props.onChange({ target: { value: 'sn-image-default' } })
  assert.equal(size().props.value, 'auto')
})

test('保存新产物目录后，所有页面共用的页脚立即显示新路径', async () => {
  const state = { ...stateFixture(), playground_dir: '/tmp/old-output', items: [] }
  const next = { ...state, playground_dir: '/tmp/new-output' }
  fetchHandler = async (url, options) => {
    assert.equal(url, '/sgen/config')
    assert.deepEqual(JSON.parse(options.body), { playground_dir: '/tmp/new-output' })
    return { ok: true, json: async () => ({ ok: true, data: next }) }
  }
  try {
    const live = renderLive(state)
    const input = findAll(live.tree, (node) => node.type === 'input' && node.props.name === 'playground_dir')[0]
    input.props.onChange({ target: { value: '/tmp/new-output' } })
    const form = findAll(live.tree, (node) => node.props?.['aria-label'] === '产物存放目录设置')[0]
    await form.props.onSubmit({ preventDefault() {} })
    const footer = findAll(live.tree, (node) => node.type === 'footer')[0]
    assert.match(textOf(footer), /\/tmp\/new-output/)
    assert.doesNotMatch(textOf(footer), /\/tmp\/old-output/)
  } finally {
    fetchHandler = async () => {
      throw new Error('未预期的网络请求')
    }
  }
})

test('从产物页删除后，试验场对应任务也同步消失', async () => {
  const item = {
    id: 'file-1',
    kind: 'image',
    source: 'playground',
    file: '/tmp/generated.png',
    name: 'generated.png',
    model: 'sn-image-default',
    prompt: '测试删除同步',
    created_at: '2026-11-10T01:00:00Z',
  }
  window.confirm = () => true
  fetchHandler = async (url, options) => {
    if (url === '/sgen/generate') {
      return { ok: true, json: async () => ({ ok: true, item }) }
    }
    if (url === '/sgen/file?id=file-1') {
      assert.equal(options.method, 'DELETE')
      return { ok: true, json: async () => ({ ok: true, id: item.id }) }
    }
    throw new Error(`未预期的请求：${url}`)
  }
  try {
    const live = renderLive(stateFixture(), { tab: 'playground' })
    const prompt = findAll(live.tree, (node) => node.type === 'textarea' && node.props.name === 'prompt')[0]
    prompt.props.onChange({ target: { value: item.prompt } })
    const form = findAll(live.tree, (node) => node.props?.['aria-label'] === 'SGeN 试验场')[0]
    form.props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(textOf(live.tree), /生成任务（1）/)

    const artifactsTab = findAll(live.tree, (node) => node.props?.role === 'tab' && textOf(node) === '产物')[0]
    artifactsTab.props.onClick()
    const remove = findAll(live.tree, (node) => node.type === 'button' && node.props['aria-label'] === '删除产物').at(-1)
    assert.ok(remove)
    await remove.props.onClick()
    assert.match(textOf(live.tree), /生成任务（0）/)
    assert.doesNotMatch(textOf(live.tree), /generated\.png/)
  } finally {
    delete window.confirm
    fetchHandler = async () => {
      throw new Error('未预期的网络请求')
    }
  }
})

test('刷新后索引暂时缺失不会误删成功任务记录', async () => {
  const item = {
    id: 'file-success',
    kind: 'image',
    source: 'playground',
    file: '/tmp/success.png',
    name: 'success.png',
    model: 'sn-image-default',
    prompt: '成功任务',
    created_at: '2026-11-10T01:00:00Z',
  }
  fetchHandler = async () => ({ ok: true, json: async () => ({ ok: true, item }) })
  try {
    const live = renderLive(stateFixture(), { tab: 'playground' })
    const prompt = findAll(live.tree, (node) => node.type === 'textarea' && node.props.name === 'prompt')[0]
    prompt.props.onChange({ target: { value: item.prompt } })
    const form = findAll(live.tree, (node) => node.props?.['aria-label'] === 'SGeN 试验场')[0]
    form.props.onSubmit({ preventDefault() {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.match(textOf(live.tree), /生成任务（1）/)

    live.setState({ ...stateFixture(), items: [] })
    assert.match(textOf(live.tree), /生成任务（1）/)
    assert.match(textOf(live.tree), /success\.png/)
  } finally {
    fetchHandler = async () => {
      throw new Error('未预期的网络请求')
    }
  }
})

test('启动时从产物索引恢复已完成的任务', () => {
  const item = {
    id: 'history-image',
    kind: 'image',
    source: 'playground',
    file: '/tmp/history.png',
    name: 'history.png',
    model: 'sn-image-default',
    prompt: '历史任务',
    created_at: '2026-11-10T01:00:00Z',
  }
  const live = renderLive({ ...stateFixture(), items: [item] }, { tab: 'playground' })
  assert.match(textOf(live.tree), /生成任务（1）/)
  assert.match(textOf(live.tree), /历史任务/)
  assert.match(textOf(live.tree), /history\.png/)
  assert.match(textOf(live.tree), /已完成/)
})

test('刷新时间在右上角刷新按钮旁持续可见', () => {
  const tree = render(stateFixture())
  const refresh = findAll(tree, (node) => node.type === 'button' && textOf(node) === '刷新')[0]
  assert.ok(refresh)
  const actions = findAll(tree, (node) => (node.props?.children || []).includes(refresh))[0]
  assert.ok(actions)
  assert.match(textOf(actions), /已更新/)
})
