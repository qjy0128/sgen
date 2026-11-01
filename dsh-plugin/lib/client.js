/**
 * dsh-sgen — 浏览器半边。
 *
 * 由 DSH 的 Client module loader 以 classic script 形式加载；factory 只注册
 * exports，真正的 DOM 副作用都在组件渲染时发生。宿主半边提供只读数据路由
 * GET /sgen/state 和 GET /sgen/file，因此这里不依赖 generated Remote namespace。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sgen',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'sgen'
    const STATE_URL = '/sgen/state'
    const REFRESH_MS = 10000

    const COLORS = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-state-idle-primary)',
      line: 'var(--dsw-alias-border-l1)',
      lineStrong: 'var(--dsw-alias-border-l2)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surface2: 'var(--dsw-alias-bg-layer-2)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      accent: 'var(--dsw-alias-brand-primary)',
    }

    const styles = {
      page: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '100%',
        padding: '28px 32px 48px',
        color: COLORS.text,
        fontSize: 13,
        lineHeight: 1.5,
        overflow: 'auto',
      },
      inner: { maxWidth: 1120, margin: '0 auto' },
      header: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 18,
      },
      brand: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
      mark: {
        width: 40,
        height: 40,
        borderRadius: 11,
        background: COLORS.surface2,
        border: `1px solid ${COLORS.line}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: COLORS.accent,
        flex: 'none',
      },
      title: {
        margin: 0,
        fontSize: 20,
        lineHeight: '28px',
        fontWeight: 650,
        letterSpacing: '-0.01em',
      },
      subtitle: { margin: '3px 0 0', color: COLORS.muted, fontSize: 12 },
      actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      button: {
        appearance: 'none',
        border: `1px solid ${COLORS.line}`,
        borderRadius: 7,
        background: COLORS.surface,
        color: COLORS.text,
        padding: '5px 10px',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
      },
      buttonActive: {
        borderColor: COLORS.accent,
        color: COLORS.accent,
      },
      stats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10,
        marginBottom: 18,
      },
      stat: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        background: COLORS.surface,
        padding: '12px 14px',
      },
      statLabel: { color: COLORS.muted, fontSize: 11 },
      statValue: {
        marginTop: 2,
        fontSize: 20,
        lineHeight: '26px',
        fontWeight: 650,
        fontVariantNumeric: 'tabular-nums',
      },
      notice: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 9,
        background: COLORS.surface2,
        color: COLORS.muted,
        padding: '9px 12px',
        marginBottom: 16,
        fontSize: 12,
      },
      noticeWarn: { borderColor: COLORS.warn, color: COLORS.text },
      filters: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 },
      filterMeta: { marginLeft: 'auto', color: COLORS.faint, fontSize: 11 },
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      },
      card: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        background: COLORS.surface,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      },
      thumbLink: {
        display: 'block',
        background: COLORS.surface2,
        color: COLORS.muted,
        textDecoration: 'none',
        borderBottom: `1px solid ${COLORS.line}`,
      },
      thumb: {
        display: 'block',
        width: '100%',
        aspectRatio: '4 / 3',
        objectFit: 'cover',
      },
      video: {
        display: 'block',
        width: '100%',
        aspectRatio: '16 / 9',
        background: '#000',
      },
      cardBody: { padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
      prompt: {
        margin: 0,
        fontSize: 12,
        lineHeight: 1.45,
        color: COLORS.text,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      metaRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        color: COLORS.faint,
        fontSize: 11,
      },
      model: { color: COLORS.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      openLink: {
        color: COLORS.accent,
        fontSize: 11,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      },
      empty: {
        border: `1px dashed ${COLORS.lineStrong}`,
        borderRadius: 12,
        padding: '34px 20px',
        textAlign: 'center',
        color: COLORS.muted,
        background: COLORS.surface,
      },
      emptyTitle: { color: COLORS.text, fontWeight: 600, marginBottom: 6 },
      error: {
        border: `1px solid ${COLORS.error}`,
        borderRadius: 9,
        background: COLORS.surface,
        color: COLORS.text,
        padding: '9px 12px',
        marginBottom: 14,
        fontSize: 12,
        whiteSpace: 'pre-wrap',
      },
      footer: {
        marginTop: 20,
        color: COLORS.faint,
        fontSize: 11,
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
      },
    }

    function formatNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    function formatDate(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      try {
        return date.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return date.toISOString().slice(0, 16).replace('T', ' ')
      }
    }

    function fileUrl(id) {
      return `/sgen/file?id=${encodeURIComponent(String(id))}`
    }

    async function fetchState(signal) {
      const response = await fetch(STATE_URL, {
        signal,
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      }
      return body.data
    }

    function SgenMark({ size = 22 }) {
      const dimension = Number(size) || 22
      return h(
        'svg',
        {
          width: dimension,
          height: dimension,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('rect', {
          x: 3,
          y: 4.5,
          width: 15.5,
          height: 13,
          rx: 3,
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('circle', { cx: 8, cy: 9.2, r: 1.5, fill: 'currentColor' }),
        h('path', {
          d: 'M4.5 15.5 8.6 11.6l3 3 2.1-2.1 2.8 3',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M19.2 2.4 19.9 4.4 21.9 5.1 19.9 5.8 19.2 7.8 18.5 5.8 16.5 5.1 18.5 4.4Z',
          fill: 'currentColor',
        }),
      )
    }

    function SgenIcon(props) {
      return h(SgenMark, { size: props && props.size ? props.size : 18 })
    }

    function Stat({ label, value, hint }) {
      return h(
        'div',
        { style: styles.stat },
        h('div', { style: styles.statLabel }, label),
        h('div', { style: styles.statValue }, value),
        hint ? h('div', { style: styles.statLabel }, hint) : null,
      )
    }

    function FilterButton({ active, children, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          style: active ? { ...styles.button, ...styles.buttonActive } : styles.button,
          onClick,
          'aria-pressed': active,
        },
        children,
      )
    }

    function GalleryCard({ item }) {
      const prompt = item.prompt || '（没有记录提示词）'
      const date = formatDate(item.created_at)
      const details = [item.model, item.size, item.seconds ? `${item.seconds}s` : '']
        .filter(Boolean)
        .join(' · ')
      const media =
        item.kind === 'video'
          ? h(
              'div',
              { style: styles.thumbLink },
              h('video', {
                src: fileUrl(item.id),
                controls: true,
                preload: 'metadata',
                style: styles.video,
                'aria-label': prompt,
              }),
            )
          : h(
              'a',
              {
                href: fileUrl(item.id),
                target: '_blank',
                rel: 'noreferrer',
                style: styles.thumbLink,
                title: item.file || prompt,
              },
              h('img', {
                src: fileUrl(item.id),
                alt: prompt,
                loading: 'lazy',
                style: styles.thumb,
                onError: (event) => {
                  event.currentTarget.style.opacity = '0.3'
                },
              }),
            )

      return h(
        'article',
        { style: styles.card },
        media,
        h(
          'div',
          { style: styles.cardBody },
          h('p', { style: styles.prompt, title: prompt }, prompt),
          h(
            'div',
            { style: styles.metaRow },
            h('span', { style: styles.model, title: details }, details || item.kind),
            h(
              'a',
              {
                href: fileUrl(item.id),
                target: '_blank',
                rel: 'noreferrer',
                style: styles.openLink,
              },
              '打开文件',
            ),
          ),
          h(
            'div',
            { style: styles.metaRow },
            h('span', null, date),
            h('span', null, item.kind === 'video' ? '视频' : '图片'),
          ),
        ),
      )
    }

    function SgenPage() {
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [refresh, setRefresh] = React.useState(0)
      const [filter, setFilter] = React.useState('all')
      const [updatedAt, setUpdatedAt] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        const controller = new AbortController()

        async function load(initial) {
          if (initial) setLoading(true)
          try {
            const next = await fetchState(controller.signal)
            if (cancelled) return
            setState(next)
            setError('')
            setUpdatedAt(new Date())
          } catch (cause) {
            if (cancelled || cause.name === 'AbortError') return
            setError(String(cause && cause.message ? cause.message : cause))
          } finally {
            if (!cancelled) setLoading(false)
          }
        }

        load(true)
        const timer = setInterval(() => load(false), REFRESH_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
          controller.abort()
        }
      }, [refresh])

      const items = React.useMemo(() => (state && Array.isArray(state.items) ? state.items : []), [state])
      const imageCount = items.filter((item) => item.kind === 'image').length
      const videoCount = items.filter((item) => item.kind === 'video').length
      const visible = filter === 'all' ? items : items.filter((item) => item.kind === filter)
      const providers = (state && state.providers) || {}
      const snKeys = formatNumber(providers.sensenova && providers.sensenova.keys)
      const agnesKeys = formatNumber(providers.agnes && providers.agnes.keys)
      const totalKeys = snKeys + agnesKeys
      const configPath = (state && state.config_path) || '~/.sgen/config.json'
      const root = (state && state.root) || ''
      const version = state && state.version ? `v${state.version}` : ''

      const tabs = h(
        'div',
        { style: styles.filters, role: 'group', 'aria-label': '作品筛选' },
        h(FilterButton, { active: filter === 'all', onClick: () => setFilter('all') }, `全部 ${items.length}`),
        h(FilterButton, { active: filter === 'image', onClick: () => setFilter('image') }, `图片 ${imageCount}`),
        h(FilterButton, { active: filter === 'video', onClick: () => setFilter('video') }, `视频 ${videoCount}`),
        h(
          'span',
          { style: styles.filterMeta },
          updatedAt ? `更新于 ${updatedAt.toLocaleTimeString()}` : loading ? '加载中…' : '',
        ),
      )

      const body = visible.length
        ? h(
            'div',
            { style: styles.grid },
            visible.map((item) => h(GalleryCard, { key: item.id, item })),
          )
        : h(
            'div',
            { style: styles.empty },
            h('div', { style: styles.emptyTitle }, items.length ? '这个分类还没有作品' : '还没有生成记录'),
            h(
              'div',
              null,
              items.length
                ? '切到“全部”看看，或在对话里继续生成。'
                : '在对话里让 Agent 用 sgen_image / sgen_video 生成；结果会自动出现在这里。',
            ),
          )

      return h(
        'section',
        { style: styles.page, 'aria-label': 'SGeN 本地作品面板' },
        h(
          'div',
          { style: styles.inner },
          h(
            'header',
            { style: styles.header },
            h(
              'div',
              { style: styles.brand },
              h('div', { style: styles.mark }, h(SgenMark, { size: 22 })),
              h(
                'div',
                null,
                h('h1', { style: styles.title }, 'sgen'),
                h(
                  'p',
                  { style: styles.subtitle },
                  `本地生图 / 生视频 · 商汤 SenseNova + Agnes${version ? ` · ${version}` : ''}`,
                ),
              ),
            ),
            h(
              'div',
              { style: styles.actions },
              h(
                'button',
                {
                  type: 'button',
                  style: styles.button,
                  onClick: () => setRefresh((value) => value + 1),
                  disabled: loading,
                },
                loading ? '刷新中…' : '刷新',
              ),
            ),
          ),
          error ? h('div', { style: styles.error }, `读取面板数据失败：${error}`) : null,
          totalKeys === 0
            ? h(
                'div',
                { style: { ...styles.notice, ...styles.noticeWarn } },
                `还没有配置 API Key。请在终端运行 sgen config init，配置会写到 ${configPath}；` +
                  '商汤和 Agnes 各注册一把免费 Key 即可开始。',
              )
            : null,
          h(
            'div',
            { style: styles.stats },
            h(Stat, { label: '商汤 Key', value: snKeys, hint: 'SenseNova' }),
            h(Stat, {
              label: 'Agnes Key',
              value: agnesKeys,
              hint: providers.agnes && providers.agnes.region === 'china' ? '中国版域名' : '国际版域名',
            }),
            h(Stat, { label: '图片', value: imageCount, hint: `共 ${items.length} 条记录` }),
            h(Stat, { label: '视频', value: videoCount, hint: '自动下载到本地' }),
          ),
          tabs,
          body,
          h(
            'footer',
            { style: styles.footer },
            (root ? `${root}\n` : '') +
              '工具由 Agent 调用 · 作品默认保存到生成时的工作目录 · 面板每 10 秒自动刷新',
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => 'sgen',
          },
          SgenIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          SgenPage,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply,
      SgenPage,
      SgenIcon,
      PANEL_ID,
    }
  },
})
