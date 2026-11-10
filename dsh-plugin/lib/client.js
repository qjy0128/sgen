/**
 * dsh-sgen — 浏览器半边。
 *
 * 由 DSH 的 Client module loader 以 classic script 形式加载；factory 只注册
 * exports，真正的 DOM 副作用都在组件渲染时发生。宿主半边提供面板数据、
 * 配置保存和作品文件路由，因此这里不依赖 generated Remote namespace。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sgen',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'sgen'
    const STATE_URL = '/sgen/state'
    const CONFIG_URL = '/sgen/config'
    const GENERATE_URL = '/sgen/generate'
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
      refreshStatus: { color: COLORS.muted, fontSize: 11, whiteSpace: 'nowrap' },
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
        outline: 'none',
        boxShadow: 'none',
      },
      buttonActive: {
        borderColor: COLORS.accent,
        background: COLORS.accent,
        color: COLORS.surface,
        fontWeight: 650,
        boxShadow: 'none',
      },
      tabs: { display: 'flex', gap: 6, marginBottom: 18, borderBottom: `1px solid ${COLORS.line}` },
      tab: {
        appearance: 'none',
        border: 'none',
        borderBottom: '2px solid transparent',
        background: 'transparent',
        color: COLORS.muted,
        padding: '8px 14px',
        fontSize: 13,
        cursor: 'pointer',
      },
      playgroundGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 16,
        alignItems: 'start',
      },
      playgroundPanel: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        background: COLORS.surface,
        padding: '16px',
      },
      playgroundTitle: { margin: '0 0 12px', fontSize: 14, fontWeight: 650 },
      kindTabs: { display: 'flex', gap: 8, marginBottom: 14 },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 120,
        border: `1px solid ${COLORS.lineStrong}`,
        borderRadius: 7,
        background: COLORS.surface2,
        color: COLORS.text,
        padding: '9px 10px',
        fontSize: 13,
        lineHeight: 1.6,
        resize: 'vertical',
        outline: 'none',
      },
      parameterGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginTop: 12,
      },
      fileInput: { width: '100%', color: COLORS.muted, fontSize: 12 },
      fileList: { margin: '6px 0 0', color: COLORS.faint, fontSize: 11, overflowWrap: 'anywhere' },
      generateBar: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
      generateButton: { padding: '7px 16px' },
      generating: { color: COLORS.muted, fontSize: 12 },
      resultEmpty: {
        border: `1px dashed ${COLORS.lineStrong}`,
        borderRadius: 8,
        padding: '36px 16px',
        textAlign: 'center',
        color: COLORS.muted,
        background: COLORS.surface2,
      },
      resultMedia: {
        display: 'block',
        width: '100%',
        maxHeight: 520,
        objectFit: 'contain',
        borderRadius: 8,
        background: COLORS.surface2,
      },
      resultMeta: { marginTop: 10, color: COLORS.muted, fontSize: 12, overflowWrap: 'anywhere' },
      resultActions: { display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' },
      panelTitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
      iconButton: {
        appearance: 'none',
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        background: COLORS.surface,
        color: COLORS.muted,
        width: 30,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        cursor: 'pointer',
        flex: 'none',
      },
      taskList: { display: 'grid', gap: 8 },
      taskRow: { border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.surface2, overflow: 'hidden' },
      taskHeader: {
        appearance: 'none',
        width: '100%',
        border: 'none',
        background: 'transparent',
        color: COLORS.text,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 10px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      taskPrompt: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      taskStatus: { color: COLORS.muted, fontSize: 11, whiteSpace: 'nowrap' },
      taskBody: { padding: 10, borderTop: `1px solid ${COLORS.line}` },
      taskMediaWrap: { position: 'relative' },
      deleteButton: { position: 'absolute', top: 8, right: 8, zIndex: 1 },
      directoryForm: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
      directoryField: { flex: '1 1 320px' },
      directoryActions: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 23, flexWrap: 'wrap' },
      settings: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        background: COLORS.surface,
        padding: '16px',
        marginBottom: 18,
      },
      settingsHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 14,
      },
      settingsTitle: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 650 },
      settingsPath: { color: COLORS.faint, fontSize: 11, overflowWrap: 'anywhere' },
      field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
      label: { color: COLORS.text, fontSize: 12, fontWeight: 600 },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        border: `1px solid ${COLORS.lineStrong}`,
        borderRadius: 7,
        background: COLORS.surface2,
        color: COLORS.text,
        padding: '7px 9px',
        fontSize: 12,
        lineHeight: '18px',
        outline: 'none',
      },
      monoInput: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      fieldHint: { color: COLORS.faint, fontSize: 11 },
      settingsFooter: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 },
      saveMessage: { color: COLORS.success, fontSize: 12 },
      settingsError: { color: COLORS.error, fontSize: 12, whiteSpace: 'pre-wrap' },
      modelIntro: { margin: '16px 0 10px', color: COLORS.muted, fontSize: 12 },
      providerModelGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12,
      },
      providerModels: {
        border: `1px solid ${COLORS.line}`,
        borderRadius: 9,
        background: COLORS.surface2,
        padding: '12px',
      },
      providerModelTitle: { margin: '0 0 10px', fontSize: 13, fontWeight: 650 },
      modelType: { marginTop: 10 },
      modelTypeTitle: { marginBottom: 6, color: COLORS.muted, fontSize: 11, fontWeight: 600 },
      modelOptions: { display: 'grid', gap: 5 },
      modelOption: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        color: COLORS.text,
        cursor: 'pointer',
      },
      modelOptionActive: { background: COLORS.surface },
      radio: { margin: 0, accentColor: COLORS.accent, flex: 'none' },
      modelId: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        overflowWrap: 'anywhere',
      },
      currentDefaults: {
        marginTop: 14,
        borderTop: `1px solid ${COLORS.line}`,
        paddingTop: 12,
        display: 'grid',
        gap: 7,
      },
      currentDefaultsTitle: { color: COLORS.text, fontSize: 12, fontWeight: 650 },
      currentDefaultRow: { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', gap: 8 },
      currentDefaultLabel: { color: COLORS.muted, fontSize: 12 },
      currentDefaultValue: { color: COLORS.text },
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

    async function saveSettings(input) {
      const response = await fetch(CONFIG_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      }
      return body.data
    }

    async function generate(input) {
      const response = await fetch(GENERATE_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      }
      return body.item
    }

    async function deleteArtifact(id) {
      const response = await fetch(`${fileUrl(id)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      }
      return body.id
    }

    function readImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(`无法读取参考图：${file.name}`))
        reader.readAsDataURL(file)
      })
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

    function IconButton({ label, onClick, disabled, children, style }) {
      return h(
        'button',
        {
          type: 'button',
          'aria-label': label,
          title: label,
          onClick,
          disabled,
          style: { ...styles.iconButton, ...style },
        },
        children,
      )
    }

    function DeleteIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 4h10M6 4V2.5h4V4m-6 0 .7 9h6.6l.7-9M6.5 6.5v4M9.5 6.5v4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function ClearIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'm3 10 6-6 4 4-6 6H3v-4Zm5-6 2-2 4 4-2 2M3 14h10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function ChevronIcon({ expanded }) {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true', style: { transform: expanded ? 'rotate(90deg)' : 'none' } },
        h('path', { d: 'm5 3 4 4-4 4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function Spinner() {
      return h(
        'svg',
        {
          class: 'sgen-spin',
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          role: 'img',
          'aria-label': '生成中',
        },
        h('circle', {
          cx: 8,
          cy: 8,
          r: 6,
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: '28 10',
        }),
      )
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

    function FilterButton({ active, children, onClick, disabled = false }) {
      return h(
        'button',
        {
          type: 'button',
          style: active ? { ...styles.button, ...styles.buttonActive } : styles.button,
          onClick,
          disabled,
          'aria-pressed': active,
        },
        children,
      )
    }

    function GalleryCard({ item, onDelete }) {
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
        h(
          'div',
          { style: styles.taskMediaWrap },
          media,
          h(IconButton, { label: '删除产物', onClick: () => onDelete(item), style: styles.deleteButton }, h(DeleteIcon)),
        ),
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

    function Field({ label, hint, children }) {
      return h(
        'label',
        { style: styles.field },
        h('span', { style: styles.label }, label),
        children,
        h('span', { style: styles.fieldHint }, hint),
      )
    }

    function ModelOption({ model, selected, onChange, disabled }) {
      const active = selected === model.id
      return h(
        'label',
        { style: active ? { ...styles.modelOption, ...styles.modelOptionActive } : styles.modelOption },
        h('input', {
          type: 'radio',
          name: `default-${model.type}-model`,
          value: model.id,
          checked: active,
          onChange: () => onChange(model.id),
          disabled,
          style: styles.radio,
        }),
        h('span', { style: styles.modelId }, model.id),
      )
    }

    function ProviderCard({ provider, label, keyCount, apiKey, onApiKeyChange, models, imageModel, videoModel, onImageChange, onVideoChange, disabled }) {
      const available = models.filter((model) => model.provider === provider)
      const renderType = (type, title, selected, onChange) => {
        const options = available.filter((model) => model.type === type)
        if (!options.length) return null
        return h(
          'div',
          { style: styles.modelType },
          h('div', { style: styles.modelTypeTitle }, title),
          h(
            'div',
            { style: styles.modelOptions },
            options.map((model) => h(ModelOption, {
              key: model.id,
              model,
              selected,
              onChange,
              disabled,
            })),
          ),
        )
      }
      return h(
        'section',
        { style: styles.providerModels, 'aria-label': `${label} 配置` },
        h('h3', { style: styles.providerModelTitle }, label),
        h(
          Field,
          {
            label: keyCount ? `API Key（已配置 ${keyCount} 把）` : 'API Key',
            hint: '多把用英文逗号分隔；留空表示不修改。',
          },
          h('input', {
            type: 'password',
            name: `${provider}-api-key`,
            value: apiKey,
            onChange: (event) => onApiKeyChange(event.target.value),
            placeholder: keyCount ? `已配置 ${keyCount} 把，留空保持不变` : '输入 API Key',
            autoComplete: 'off',
            spellCheck: false,
            disabled,
            style: { ...styles.input, ...styles.monoInput },
          }),
        ),
        renderType('image', '图片模型（选择默认）', imageModel, onImageChange),
        renderType('video', '视频模型（选择默认）', videoModel, onVideoChange),
      )
    }

    function CurrentDefaults({ defaults }) {
      return h(
        'div',
        { style: styles.currentDefaults, 'aria-label': '当前默认模型（只读）' },
        h('div', { style: styles.currentDefaultsTitle }, '当前默认模型'),
        h(
          'div',
          { style: styles.currentDefaultRow },
          h('span', { style: styles.currentDefaultLabel }, '图片'),
          h('code', { style: { ...styles.currentDefaultValue, ...styles.modelId } }, defaults.image || '未设置'),
        ),
        h(
          'div',
          { style: styles.currentDefaultRow },
          h('span', { style: styles.currentDefaultLabel }, '视频'),
          h('code', { style: { ...styles.currentDefaultValue, ...styles.modelId } }, defaults.video || '未设置'),
        ),
      )
    }

    function makeTaskId() {
      return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }

    function TaskResults({ tasks, expandedId, onToggle, onDelete, onRetry }) {
      return h(
        'section',
        { style: styles.playgroundPanel, 'aria-label': '试验场任务列表' },
        h('h2', { style: styles.playgroundTitle }, `生成任务（${tasks.length}）`),
        tasks.length
          ? h(
              'div',
              { style: styles.taskList },
              tasks.map((task) => {
                const expanded = expandedId === task.id
                const status = task.status === 'running' ? '生成中' : task.status === 'completed' ? '已完成' : '失败'
                return h(
                  'article',
                  { key: task.id, style: styles.taskRow },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.taskHeader,
                      onClick: () => onToggle(task.id),
                      'aria-expanded': expanded,
                    },
                    task.status === 'running' ? h(Spinner) : h(ChevronIcon, { expanded }),
                    h('span', { style: styles.taskPrompt, title: task.prompt }, task.prompt),
                    h('span', { style: styles.taskStatus }, status),
                  ),
                  expanded
                    ? h(
                        'div',
                        { style: styles.taskBody },
                        task.status === 'running'
                          ? '正在生成，完成后可在这里预览。'
                          : task.status === 'failed'
                            ? h(
                                'div',
                                { style: styles.taskMediaWrap },
                                h('div', { style: styles.settingsError }, task.error),
                                h('button', { type: 'button', style: { ...styles.button, marginTop: 8 }, onClick: () => onRetry(task) }, '重试'),
                                h(
                                  IconButton,
                                  { label: '删除任务', onClick: () => onDelete(task), style: styles.deleteButton },
                                  h(DeleteIcon),
                                ),
                              )
                            : h(
                                'div',
                                null,
                                h(
                                  'div',
                                  { style: styles.taskMediaWrap },
                                  task.kind === 'video'
                                    ? h('video', { src: fileUrl(task.item.id), controls: true, style: styles.resultMedia })
                                    : h('img', { src: fileUrl(task.item.id), alt: task.prompt, style: styles.resultMedia }),
                                  h(
                                    IconButton,
                                    { label: '删除产物', onClick: () => onDelete(task), style: styles.deleteButton },
                                    h(DeleteIcon),
                                  ),
                                ),
                                h('div', { style: styles.resultMeta }, `${task.model} · ${task.item.file}`),
                                h(
                                  'div',
                                  { style: styles.resultActions },
                                  h('a', { href: fileUrl(task.item.id), target: '_blank', rel: 'noreferrer', style: styles.openLink }, '打开原文件'),
                                ),
                              ),
                      )
                    : null,
                )
              }),
            )
          : h('div', { style: styles.resultEmpty }, '还没有试验任务。提交后，最新任务会自动展开。'),
      )
    }

    function Playground({ state, onGenerated, onRunningChange, onDelete, deletedIds = [] }) {
      const models = Array.isArray(state.models) ? state.models : []
      const defaults = state.default_models || {}
      const [kind, setKind] = React.useState('image')
      const [prompt, setPrompt] = React.useState('')
      const [model, setModel] = React.useState(defaults.image || '')
      const [size, setSize] = React.useState('')
      const [ratio, setRatio] = React.useState('')
      const [seconds, setSeconds] = React.useState('')
      const [files, setFiles] = React.useState([])
      const [running, setRunning] = React.useState(false)
      const [error, setError] = React.useState('')
      const [tasks, setTasks] = React.useState(() => (state.items || [])
        .filter((item) => item.source === 'playground')
        .map((item) => ({
          id: `history-${item.id}`,
          kind: item.kind,
          prompt: item.prompt,
          model: item.model,
          size: item.size || '',
          ratio: item.ratio || '',
          seconds: item.seconds || '',
          files: [],
          status: 'completed',
          item,
        })))
      const [expandedId, setExpandedId] = React.useState(null)
      const visibleTasks = React.useMemo(
        () => tasks.filter((task) => !deletedIds.includes(task.item?.id)),
        [tasks, deletedIds],
      )
      const visibleExpandedId = visibleTasks.some((task) => task.id === expandedId)
        ? expandedId
        : visibleTasks[0]?.id ?? null
      const selected = models.find((item) => item.id === model && item.type === kind)
      const sizeTiers = Array.isArray(selected?.sizeTiers) ? selected.sizeTiers : []
      const ratios = Array.isArray(selected?.ratios) ? selected.ratios : []
      const supportsSize = !selected || sizeTiers.length > 0 || selected.customSize !== false
      const supportsRatio = !selected || !Array.isArray(selected.ratios) || ratios.length > 0
      const supportsReferences = !selected || selected.referenceImages !== false
      const secondsRule = selected?.seconds

      function changeModel(next) {
        const nextModel = models.find((item) => item.id === next && item.type === kind)
        setModel(next)
        setSize(nextModel?.defaultSize || '')
        setRatio('')
        setSeconds('')
      }

      function changeKind(next) {
        const nextModelId = (next === 'image' ? defaults.image : defaults.video) || ''
        const nextModel = models.find((item) => item.id === nextModelId && item.type === next)
        setKind(next)
        setModel(nextModelId)
        setSize(nextModel?.defaultSize || '')
        setRatio('')
        setSeconds('')
        setError('')
      }

      function clearForm() {
        setPrompt('')
        setSize('')
        setRatio('')
        setSeconds('')
        setFiles([])
      }

      async function generateNow(retryTask) {
        const retry = retryTask && typeof retryTask.id === 'string' ? retryTask : null
        const draft = retry || { kind, prompt, model, size, ratio, seconds, files }
        if (running || !draft.prompt.trim()) return
        const id = makeTaskId()
        const task = {
          id,
          kind: draft.kind,
          prompt: draft.prompt,
          model: draft.model,
          size: draft.size || '',
          ratio: draft.ratio || '',
          seconds: draft.seconds || '',
          files: draft.files || [],
          status: 'running',
        }
        setRunning(true)
        onRunningChange?.(1)
        setError('')
        setTasks((current) => [task, ...current])
        setExpandedId(id)
        try {
          const payload = { kind: draft.kind, prompt: draft.prompt, model: draft.model }
          if (draft.size?.trim() && (retry || supportsSize)) payload.size = draft.size
          if (draft.ratio?.trim() && (retry || supportsRatio)) payload.ratio = draft.ratio
          if (draft.kind === 'video' && draft.seconds) payload.seconds = draft.seconds
          if (task.files.length && (retry || supportsReferences)) {
            payload.images = await Promise.all(task.files.map(async (file) => ({ data_url: await readImage(file) })))
          }
          const item = await generate(payload)
          setTasks((current) => current.map((entry) => entry.id === id ? { ...entry, status: 'completed', item } : entry))
          onGenerated(item)
        } catch (cause) {
          const message = String(cause && cause.message ? cause.message : cause)
          setTasks((current) => current.map((entry) => entry.id === id ? { ...entry, status: 'failed', error: message } : entry))
          setError(message)
        } finally {
          setRunning(false)
          onRunningChange?.(0)
        }
      }

      async function deleteTask(task) {
        if (task.status === 'failed') {
          setTasks((current) => current.filter((entry) => entry.id !== task.id))
          if (expandedId === task.id) setExpandedId(null)
          return
        }
        if (!task.item || !onDelete) return
        const deleted = await onDelete(task.item)
        if (deleted) {
          setTasks((current) => current.filter((entry) => entry.id !== task.id))
          if (expandedId === task.id) setExpandedId(null)
        }
      }

      const modelGroups = [
        ['sensenova', '商汤 SenseNova'],
        ['agnes', 'Agnes'],
      ].map(([provider, label]) => {
        const options = models.filter((item) => item.provider === provider && item.type === kind)
        if (!options.length) return null
        return h(
          'optgroup',
          { key: provider, label },
          options.map((item) => h('option', { key: item.id, value: item.id }, item.id)),
        )
      })

      return h(
        'div',
        { style: styles.playgroundGrid },
        h(
          'form',
          {
            style: styles.playgroundPanel,
            'aria-label': 'SGeN 试验场',
            onSubmit: (event) => {
              event.preventDefault()
              generateNow()
            },
          },
          h(
            'div',
            { style: styles.panelTitleRow },
            h('h2', { style: { ...styles.playgroundTitle, margin: 0 } }, '试验场'),
            h(IconButton, { label: '清空表单', onClick: clearForm, disabled: running }, h(ClearIcon)),
          ),
          h(
            'div',
            { style: styles.kindTabs, role: 'group', 'aria-label': '生成类型' },
            h(FilterButton, { active: kind === 'image', disabled: running, onClick: () => changeKind('image') }, '图片'),
            h(FilterButton, { active: kind === 'video', disabled: running, onClick: () => changeKind('video') }, '视频'),
          ),
          h(
            Field,
            { label: '提示词', hint: '描述想生成的内容；失败重试会保留当前内容。' },
            h('textarea', {
              name: 'prompt',
              value: prompt,
              onChange: (event) => setPrompt(event.target.value),
              placeholder: kind === 'image' ? '例如：一张极简风格的产品海报' : '例如：镜头缓慢推进，海面上的帆船迎着日落航行',
              disabled: running,
              style: styles.textarea,
            }),
          ),
          h(
            'div',
            { style: styles.parameterGrid },
            h(
              Field,
              { label: '模型', hint: '默认使用配置 Tab 中保存的默认模型。' },
              h(
                'select',
                {
                  name: 'model',
                  value: model,
                  onChange: (event) => changeModel(event.target.value),
                  disabled: running,
                  style: styles.input,
                },
                model && !selected ? h('option', { value: model }, `${model}（自定义）`) : null,
                modelGroups,
              ),
            ),
            h(
              Field,
              { label: '尺寸', hint: supportsSize ? '可选择档位或输入精确像素。' : '当前模型无需设置尺寸。' },
              h('input', {
                type: 'text',
                name: 'size',
                list: 'sgen-playground-sizes',
                value: size,
                onChange: (event) => setSize(event.target.value),
                placeholder: '默认',
                disabled: running || !supportsSize,
                style: { ...styles.input, ...styles.monoInput },
              }),
            ),
            h(
              Field,
              { label: '比例', hint: supportsRatio ? '留空使用模型默认值。' : '当前模型不支持比例参数。' },
              h('input', {
                type: 'text',
                name: 'ratio',
                list: 'sgen-playground-ratios',
                value: ratio,
                onChange: (event) => setRatio(event.target.value),
                placeholder: '默认',
                disabled: running || !supportsRatio,
                style: { ...styles.input, ...styles.monoInput },
              }),
            ),
            kind === 'video'
              ? h(
                  Field,
                  { label: '时长（秒）', hint: secondsRule ? `${secondsRule.min}–${secondsRule.max} 秒，默认 ${secondsRule.default} 秒。` : '留空使用模型默认值。' },
                  h('input', {
                    type: 'number',
                    name: 'seconds',
                    value: seconds,
                    min: secondsRule?.min,
                    max: secondsRule?.max,
                    step: 1,
                    onChange: (event) => setSeconds(event.target.value),
                    placeholder: secondsRule?.default ? String(secondsRule.default) : '默认',
                    disabled: running,
                    style: styles.input,
                  }),
                )
              : null,
          ),
          h('datalist', { id: 'sgen-playground-sizes' }, sizeTiers.map((value) => h('option', { key: value, value }))),
          h('datalist', { id: 'sgen-playground-ratios' }, ratios.map((value) => h('option', { key: value, value }))),
          h(
            'div',
            { style: styles.modelType },
            h(
              Field,
              { label: '参考图（可选）', hint: supportsReferences ? '支持多张 PNG、JPEG、WebP 或 GIF。' : '当前模型不支持参考图。' },
              h('input', {
                type: 'file',
                accept: '.png,.jpg,.jpeg,.webp,.gif',
                multiple: true,
                onChange: (event) => setFiles(Array.from(event.target.files || [])),
                disabled: running || !supportsReferences,
                style: styles.fileInput,
              }),
            ),
            files.length ? h('div', { style: styles.fileList }, files.map((file) => file.name).join('、')) : null,
          ),
          error
            ? h(
                'div',
                { style: { ...styles.error, marginTop: 14 } },
                `生成失败：${error}`,
                h('button', { type: 'button', style: { ...styles.button, marginLeft: 10 }, onClick: generateNow, disabled: running }, '重试'),
              )
            : null,
          h(
            'div',
            { style: styles.generateBar },
            h(
              'button',
              {
                type: 'submit',
                style: { ...styles.button, ...styles.buttonActive, ...styles.generateButton },
                disabled: running || !prompt.trim(),
              },
              running ? '正在生成…' : `生成${kind === 'image' ? '图片' : '视频'}`,
            ),
            running
              ? h('span', { style: styles.generating }, kind === 'video' ? '视频任务正在生成并下载，请耐心等待。' : '正在调用模型并下载结果。')
              : null,
          ),
        ),
        h(TaskResults, {
          tasks: visibleTasks,
          expandedId: visibleExpandedId,
          onToggle: (id) => setExpandedId((current) => current === id ? null : id),
          onDelete: deleteTask,
          onRetry: (task) => generateNow(task),
        }),
      )
    }

    function DirectoryPanel({ state, onSaved }) {
      const [directory, setDirectory] = React.useState(state.playground_dir || '')
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [error, setError] = React.useState('')

      async function submit(event) {
        event.preventDefault()
        if (saving || !directory.trim()) return
        if (directory.trim() === (state.playground_dir || '')) {
          setMessage('目录没有变化。')
          return
        }
        setSaving(true)
        setMessage('')
        setError('')
        try {
          const next = await saveSettings({ playground_dir: directory })
          setDirectory(next.playground_dir || '')
          setMessage('产物目录已保存。')
          onSaved(next)
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        } finally {
          setSaving(false)
        }
      }

      return h(
        'form',
        { style: styles.directoryForm, onSubmit: submit, 'aria-label': '产物存放目录设置' },
        h(
          'div',
          { style: styles.directoryField },
          h(
            Field,
            { label: '产物存放目录', hint: '只影响后续试验场生成；已有产物不会移动。' },
            h('input', {
              type: 'text',
              name: 'playground_dir',
              value: directory,
              onChange: (event) => setDirectory(event.target.value),
              disabled: saving,
              style: { ...styles.input, ...styles.monoInput },
            }),
          ),
        ),
        h(
          'div',
          { style: styles.directoryActions },
          h('button', { type: 'submit', style: { ...styles.button, ...styles.buttonActive }, disabled: saving || !directory.trim() }, saving ? '保存中…' : '保存目录'),
          error
            ? h('span', { style: styles.settingsError }, error)
            : h('span', { style: styles.saveMessage }, message),
        ),
      )
    }

    function ConfigPanel({ state, onSaved }) {
      const providers = state.providers || {}
      const [apiKeys, setApiKeys] = React.useState({ sensenova: '', agnes: '' })
      const defaults = state.default_models || {}
      const [imageModel, setImageModel] = React.useState(defaults.image || '')
      const [videoModel, setVideoModel] = React.useState(defaults.video || '')
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [error, setError] = React.useState('')

      function updateApiKey(provider, value) {
        setApiKeys((current) => ({ ...current, [provider]: value }))
      }

      async function submit(event) {
        event.preventDefault()
        if (saving) return
        setMessage('')
        setError('')
        const payload = { api_keys: apiKeys }
        if (imageModel.trim() !== (defaults.image || '')) payload.default_image_model = imageModel
        if (videoModel.trim() !== (defaults.video || '')) payload.default_video_model = videoModel
        const changed = Object.values(apiKeys).some((key) => key.trim()) ||
          ['default_image_model', 'default_video_model'].some((key) => payload[key] !== undefined)
        if (!changed) {
          setMessage('没有需要保存的修改。')
          return
        }
        setSaving(true)
        try {
          const next = await saveSettings(payload)
          setApiKeys({ sensenova: '', agnes: '' })
          setImageModel(next.default_models?.image || '')
          setVideoModel(next.default_models?.video || '')
          setMessage('配置已保存，后续生成立即使用新设置。')
          onSaved(next)
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        } finally {
          setSaving(false)
        }
      }

      return h(
        'section',
        { style: styles.settings, 'aria-label': 'SGeN 连接与模型配置' },
        h(
          'div',
          { style: styles.settingsHeader },
          h('h2', { style: styles.settingsTitle }, '连接与模型'),
          h('span', { style: styles.settingsPath }, state.config_path || '~/.sgen/config.json'),
        ),
        h(
          'form',
          { onSubmit: submit },
          h('div', { style: styles.modelIntro }, '每家服务商独立配置；勾选默认模型后点击“保存配置”生效。'),
          h(
            'div',
            { style: styles.providerModelGrid },
            h(ProviderCard, {
              provider: 'sensenova',
              label: '商汤 SenseNova',
              keyCount: providers.sensenova?.keys || 0,
              apiKey: apiKeys.sensenova,
              onApiKeyChange: (value) => updateApiKey('sensenova', value),
              models: state.models || [],
              imageModel,
              videoModel,
              onImageChange: setImageModel,
              onVideoChange: setVideoModel,
              disabled: saving,
            }),
            h(ProviderCard, {
              provider: 'agnes',
              label: 'Agnes',
              keyCount: providers.agnes?.keys || 0,
              apiKey: apiKeys.agnes,
              onApiKeyChange: (value) => updateApiKey('agnes', value),
              models: state.models || [],
              imageModel,
              videoModel,
              onImageChange: setImageModel,
              onVideoChange: setVideoModel,
              disabled: saving,
            }),
          ),
          h(
            'div',
            { style: styles.settingsFooter, 'aria-live': 'polite' },
            h(
              'button',
              {
                type: 'submit',
                style: { ...styles.button, ...styles.buttonActive },
                disabled: saving,
              },
              saving ? '保存中…' : '保存配置',
            ),
            error
              ? h('span', { style: styles.settingsError }, `保存失败：${error}`)
              : h('span', { style: styles.saveMessage }, message),
          ),
          h(CurrentDefaults, { defaults }),
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
      const [tab, setTab] = React.useState('playground')
      const [activeRuns, setActiveRuns] = React.useState(0)
      const [deletedIds, setDeletedIds] = React.useState([])

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

      const items = React.useMemo(
        () => (state && Array.isArray(state.items) ? state.items.filter((item) => item.source === 'playground') : []),
        [state],
      )
      const imageCount = items.filter((item) => item.kind === 'image').length
      const videoCount = items.filter((item) => item.kind === 'video').length
      const visible = filter === 'all' ? items : items.filter((item) => item.kind === filter)
      const providers = (state && state.providers) || {}
      const snKeys = formatNumber(providers.sensenova && providers.sensenova.keys)
      const agnesKeys = formatNumber(providers.agnes && providers.agnes.keys)
      const totalKeys = snKeys + agnesKeys
      const configPath = (state && state.config_path) || '~/.sgen/config.json'
      const outputDir = (state && state.playground_dir) || ''
      const version = state && state.version ? `v${state.version}` : ''

      async function deleteProduct(item) {
        if (!window.confirm(`确定删除这个产物吗？\n${item.name || item.file || item.id}\n文件和产物记录都会被删除，且无法恢复。`)) return false
        try {
          await deleteArtifact(item.id)
          setDeletedIds((current) => [...new Set([...current, item.id])])
          setState((current) => current
            ? { ...current, items: (current.items || []).filter((entry) => entry.id !== item.id) }
            : current)
          setError('')
          setUpdatedAt(new Date())
          return true
        } catch (cause) {
          setError(`删除失败：${String(cause && cause.message ? cause.message : cause)}`)
          return false
        }
      }

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
            visible.map((item) => h(GalleryCard, { key: item.id, item, onDelete: deleteProduct })),
          )
        : h(
            'div',
            { style: styles.empty },
            h('div', { style: styles.emptyTitle }, items.length ? '这个分类还没有作品' : '还没有生成记录'),
            h(
              'div',
              null,
              items.length
                ? '切到“全部”看看，或在试验场继续生成。'
                : '在试验场生成图片或视频，结果会自动出现在这里。',
            ),
          )

      const navigation = h(
        'nav',
        { style: styles.tabs, role: 'tablist', 'aria-label': 'SGeN 功能' },
        [
          ['playground', '试验场'],
          ['config', '配置'],
          ['artifacts', '产物'],
        ].map(([id, label]) => {
          const active = tab === id
          return h(
            'button',
            {
              key: id,
              type: 'button',
              role: 'tab',
              'aria-selected': active,
              style: {
                ...styles.tab,
                color: active ? COLORS.accent : COLORS.muted,
                borderBottomColor: active ? COLORS.accent : 'transparent',
                fontWeight: active ? 650 : 400,
              },
              onClick: () => setTab(id),
            },
            label,
            id === 'playground' && activeRuns > 0 ? h(Spinner) : null,
          )
        }),
      )

      const playground = !state
        ? null
        : h(
            'div',
            { style: { display: tab === 'playground' ? '' : 'none' }, 'aria-hidden': tab !== 'playground' },
            h(Playground, {
              state,
              onRunningChange: setActiveRuns,
              onDelete: deleteProduct,
              deletedIds,
              onGenerated: (item) => {
                setState((current) => current
                  ? { ...current, items: [item, ...(current.items || []).filter((entry) => entry.id !== item.id)] }
                  : current)
                setUpdatedAt(new Date())
              },
            }),
          )

      const content = !state || tab === 'playground'
        ? null
        : tab === 'config'
            ? h(
                'div',
                null,
                totalKeys === 0
                  ? h(
                      'div',
                      { style: { ...styles.notice, ...styles.noticeWarn } },
                      `还没有配置 API Key。请在下方对应服务商卡片中填写，配置会写到 ${configPath}。`,
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
                ),
                h(ConfigPanel, {
                  state,
                  onSaved: (next) => {
                    setState(next)
                    setUpdatedAt(new Date())
                  },
                }),
              )
            : h(
                'div',
                null,
                h(DirectoryPanel, {
                  state,
                  onSaved: (next) => {
                    setState(next)
                    setUpdatedAt(new Date())
                  },
                }),
                h(
                  'div',
                  { style: styles.stats },
                  h(Stat, { label: '图片', value: imageCount, hint: `共 ${items.length} 条记录` }),
                  h(Stat, { label: '视频', value: videoCount, hint: '自动下载到本地' }),
                ),
                tabs,
                body,
              )

      return h(
        'section',
        { style: styles.page, 'aria-label': 'SGeN 工作台' },
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
              updatedAt
                ? h(
                    'span',
                    { style: styles.refreshStatus, role: 'status' },
                    `已更新 ${updatedAt.toLocaleTimeString()}`,
                  )
                : null,
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
          navigation,
          h('style', null, '.sgen-spin{animation:sgen-spin-rotate 1s linear infinite;transform-origin:center}@keyframes sgen-spin-rotate{to{transform:rotate(360deg)}}'),
          playground,
          content,
          h(
            'footer',
            { style: styles.footer },
            (outputDir ? `${outputDir}\n` : '') +
              '试验场产物自动保存并登记到产物 Tab · 面板每 10 秒自动刷新',
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
      TaskResults,
      PANEL_ID,
    }
  },
})
