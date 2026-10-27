/**
 * client.js —— DSH Web 瀏覽器端設定介面 (Instagram FastMCP 核心服務面板)
 * ============================================================================
 * 設計規範遵循:
 *  - .agents/skills/design-taste-frontend
 *  - references/app-screens.md (Forms & Settings, KPIs, Quiet Surfaces)
 * ============================================================================
 */

window.__ModuleLoader__.load({
  id: '@luoyi-dsh/instagram-mcp',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const API = '/api/instagram/mcp'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
    }

    const jget = async (path) => asJson(await fetch(API + path, { credentials: 'same-origin' }))
    const jpost = async (path, body) =>
      asJson(
        await fetch(API + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
      )

    // 精緻向量 SVG 圖標 (嚴禁 Emoji，遵循 anti-slop 規範)
    const Icon = {
      Server: ({ size = 18 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('rect', { width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2' }),
          h('rect', { width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2' }),
          h('line', { x1: '6', x2: '6.01', y1: '6', y2: '6' }),
          h('line', { x1: '6', x2: '6.01', y1: '18', y2: '18' })
        ),
      Refresh: ({ size = 14, spinning = false }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: spinning ? { animation: 'mcp-spin 1s linear infinite' } : {},
          },
          h('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
          h('path', { d: 'M21 3v5h-5' }),
          h('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
          h('path', { d: 'M8 16H3v5' })
        ),
      Shield: ({ size = 15 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' })
        ),
      Key: ({ size = 15 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('circle', { cx: '7.5', cy: '15.5', r: '5.5' }),
          h('path', { d: 'm21 2-9.6 9.6' }),
          h('path', { d: 'm15.5 7.5 3 3L22 7l-3-3' })
        ),
      Terminal: ({ size = 15 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('polyline', { points: '4 17 10 11 4 5' }),
          h('line', { x1: '12', x2: '20', y1: '19', y2: '19' })
        ),
      Check: ({ size = 14 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('polyline', { points: '20 6 9 17 4 12' })
        ),
      Eye: ({ size = 14 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }),
          h('circle', { cx: '12', cy: '12', r: '3' })
        ),
      EyeOff: ({ size = 14 }) =>
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }),
          h('path', { d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }),
          h('path', { d: 'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }),
          h('line', { x1: '2', x2: '22', y1: '2', y2: '22' })
        ),
    }

    const CSS = `
@keyframes mcp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.mcp-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
  padding: 8px 12px 60px;
  color: var(--dsw-alias-label-primary, #e2e8f0);
  font-family: inherit;
  box-sizing: border-box;
}
.mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  padding-bottom: 16px;
  gap: 12px;
}
.mcp-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mcp-avatar {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: rgba(225, 48, 108, 0.12);
  color: #e1306c;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(225, 48, 108, 0.25);
  flex-shrink: 0;
}
.mcp-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.mcp-subtitle {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  margin: 2px 0 0;
}
.mcp-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.mcp-status-pill.running {
  background: rgba(16, 185, 129, 0.12);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.mcp-status-pill.stopped {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.25);
}
.mcp-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.mcp-status-pill.running .mcp-status-dot { background: #10b981; }
.mcp-status-pill.stopped .mcp-status-dot { background: #64748b; }

.mcp-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  padding-bottom: 8px;
}
.mcp-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mcp-tab-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #ffffff;
}
.mcp-tab-btn.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  color: #ffffff;
}

.mcp-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mcp-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mcp-field-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  align-items: center;
  gap: 16px;
}
@media (max-width: 680px) {
  .mcp-field-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
.mcp-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #94a3b8);
}
.mcp-field-desc {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #64748b);
  margin-top: 2px;
}
.mcp-input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: rgba(0, 0, 0, 0.25);
  color: #f1f5f9;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.mcp-input:focus {
  outline: none;
  border-color: #e1306c;
  box-shadow: 0 0 0 1px #e1306c;
}
.mcp-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.mcp-input-wrap .mcp-input {
  padding-right: 32px;
}
.mcp-input-toggle {
  position: absolute;
  right: 6px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mcp-input-toggle:hover { color: #ffffff; }

.mcp-switch-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
}
.mcp-toggle-btn {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
  border: 0;
  padding: 0;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.mcp-toggle-btn.on { background: #10b981; }
.mcp-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  transition: left 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.mcp-toggle-btn.on .mcp-toggle-thumb { left: 18px; }

.mcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.05);
  color: #f1f5f9;
  transition: all 0.15s ease;
}
.mcp-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}
.mcp-btn-icon {
  width: 32px;
  padding: 0;
  flex-shrink: 0;
}
.mcp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mcp-btn-primary {
  background: #e1306c;
  border-color: #e1306c;
  color: #ffffff;
}
.mcp-btn-primary:hover:not(:disabled) {
  background: #d0205c;
  border-color: #d0205c;
}

.mcp-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  margin-top: 8px;
}
.mcp-action-status {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mcp-action-status.saved { color: #34d399; }
.mcp-action-status.dirty { color: #fbbf24; }
.mcp-action-status.error { color: #f87171; }
`

    function McpPanel() {
      const [tab, setTab] = useState('status')
      const [config, setConfig] = useState(null)
      const [status, setStatus] = useState(null)
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [restarting, setRestarting] = useState(false)
      const [isDirty, setIsDirty] = useState(false)
      const [saveNotice, setSaveNotice] = useState(null)
      const [showPassword, setShowPassword] = useState(false)

      const loadData = async () => {
        setLoading(true)
        try {
          const [cfgRes, statusRes] = await Promise.all([
            jget('/config'),
            jget('/status').catch(() => ({ ok: false })),
          ])
          if (cfgRes?.ok) {
            setConfig(cfgRes.config)
            setIsDirty(false)
          }
          if (statusRes?.ok) {
            setStatus(statusRes)
          }
        } catch (e) {
          console.error('[IG-MCP] 載入資料失敗:', e)
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        loadData()
      }, [])

      const updateConfig = (key, value) => {
        setConfig((prev) => {
          const next = { ...prev, [key]: value }
          setIsDirty(true)
          return next
        })
      }

      const handleSave = async () => {
        if (!config) return
        setSaving(true)
        setSaveNotice(null)
        try {
          const res = await jpost('/config', config)
          if (res?.ok) {
            setConfig(res.config)
            setIsDirty(false)
            setSaveNotice({ type: 'saved', text: 'FastMCP 配置已成功儲存！' })
            setTimeout(() => setSaveNotice(null), 3000)
          }
        } catch (e) {
          setSaveNotice({ type: 'error', text: `儲存失敗: ${e.message}` })
        } finally {
          setSaving(false)
        }
      }

      const handleRestart = async () => {
        setRestarting(true)
        try {
          const res = await jpost('/restart', {})
          if (res?.ok) {
            setSaveNotice({ type: 'saved', text: 'FastMCP 服務重啟完成！' })
            await loadData()
            setTimeout(() => setSaveNotice(null), 3000)
          }
        } catch (e) {
          setSaveNotice({ type: 'error', text: `重啟失敗: ${e.message}` })
        } finally {
          setRestarting(false)
        }
      }

      const handleTestLogin = async () => {
        setRestarting(true)
        try {
          const res = await jpost('/login', {
            username: config?.username,
            password: config?.password,
            twoFactorCode: config?.twoFactorCode,
            proxyUrl: config?.proxyUrl,
          })
          if (res?.ok) {
            setSaveNotice({ type: 'saved', text: `驗證成功: ${res.loginStatus?.message || '已就緒'}` })
          } else {
            setSaveNotice({ type: 'error', text: `驗證失敗: ${res.loginStatus?.message || '未知錯誤'}` })
          }
          await loadData()
        } catch (e) {
          setSaveNotice({ type: 'error', text: `連線異常: ${e.message}` })
        } finally {
          setRestarting(false)
        }
      }

      if (loading || !config) {
        return h('div', { className: 'mcp-container' }, '載入 FastMCP 設定中...')
      }

      const isRunning = Boolean(status?.mcpRunning || status?.mcpReady)

      return h(
        'div',
        { className: 'mcp-container' },
        // 頂部導航
        h(
          'div',
          { className: 'mcp-header' },
          h(
            'div',
            { className: 'mcp-header-left' },
            h('div', { className: 'mcp-avatar' }, h(Icon.Server)),
            h(
              'div',
              null,
              h('h2', { className: 'mcp-title' }, 'Instagram FastMCP 核心服務'),
              h('p', { className: 'mcp-subtitle' }, 'Python 子進程生命週期維持、Session 快取與 MCP 標準工具介面')
            )
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
              'span',
              { className: `mcp-status-pill ${isRunning ? 'running' : 'stopped'}` },
              h('span', { className: 'mcp-status-dot' }),
              isRunning ? 'FastMCP 運行中' : '子進程未連線'
            ),
            h(
              'button',
              {
                className: 'mcp-btn mcp-btn-icon',
                onClick: handleRestart,
                disabled: restarting,
                title: restarting ? '正在重啟...' : '重啟服務',
                'aria-label': restarting ? '正在重啟...' : '重啟服務',
              },
              h(Icon.Refresh, { spinning: restarting })
            )
          )
        ),

        // 頁籤導覽
        h(
          'div',
          { className: 'mcp-tabs' },
          h(
            'button',
            {
              className: `mcp-tab-btn ${tab === 'status' ? 'active' : ''}`,
              onClick: () => setTab('status'),
            },
            h(Icon.Terminal),
            '服務狀態與環境'
          ),
          h(
            'button',
            {
              className: `mcp-tab-btn ${tab === 'auth' ? 'active' : ''}`,
              onClick: () => setTab('auth'),
            },
            h(Icon.Key),
            '帳號與憑證'
          ),
          h(
            'button',
            {
              className: `mcp-tab-btn ${tab === 'env' ? 'active' : ''}`,
              onClick: () => setTab('env'),
            },
            h(Icon.Shield),
            '進階參數配置'
          )
        ),

        // TAB 1: 服務狀態
        tab === 'status' &&
          h(
            'div',
            { className: 'mcp-card' },
            h('div', { className: 'mcp-card-title' }, h(Icon.Server), 'FastMCP 執行環境指標'),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', { className: 'mcp-field-label' }, '登入與會話狀態'),
              h(
                'div',
                { style: { fontSize: '13px', color: status?.loginStatus?.ok ? '#34d399' : '#fbbf24' } },
                status?.loginStatus?.message || (isRunning ? '已啟動但尚未驗證帳號' : '未連線')
              )
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', { className: 'mcp-field-label' }, 'Session 快取檔案'),
              h(
                'div',
                { style: { fontSize: '12px', fontFamily: 'monospace' } },
                status?.sessionExists ? '✅ 已存在有效 Session 快取' : '⚠️ 尚未偵測到 Session 快取檔案'
              )
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', { className: 'mcp-field-label' }, 'Python 虛擬環境'),
              h('div', { style: { fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' } }, status?.pythonPath || '自動偵測系統環境')
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '8px', paddingTop: '8px' } },
              h(
                'button',
                {
                  className: 'mcp-btn mcp-btn-primary',
                  onClick: handleTestLogin,
                  disabled: restarting,
                },
                '測試驗證登入'
              ),
              h(
                'button',
                {
                  className: 'mcp-btn',
                  onClick: loadData,
                },
                '重新整理狀態'
              )
            )
          ),

        // TAB 2: 帳號與憑證
        tab === 'auth' &&
          h(
            'div',
            { className: 'mcp-card' },
            h('div', { className: 'mcp-card-title' }, h(Icon.Key), 'Instagram 認證憑證'),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, 'Instagram 帳號'), h('div', { className: 'mcp-field-desc' }, '用戶名稱（不含 @）')),
              h('input', {
                className: 'mcp-input',
                value: config.username || '',
                placeholder: '例如: your_username',
                onChange: (e) => updateConfig('username', e.target.value),
              })
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, '密碼'), h('div', { className: 'mcp-field-desc' }, '已有 Session 時可留空')),
              h(
                'div',
                { className: 'mcp-input-wrap' },
                h('input', {
                  className: 'mcp-input',
                  type: showPassword ? 'text' : 'password',
                  value: config.password || '',
                  placeholder: 'Instagram 帳號密碼',
                  onChange: (e) => updateConfig('password', e.target.value),
                }),
                h(
                  'button',
                  {
                    className: 'mcp-input-toggle',
                    type: 'button',
                    onClick: () => setShowPassword(!showPassword),
                  },
                  showPassword ? h(Icon.EyeOff) : h(Icon.Eye)
                )
              )
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, '2FA 雙步驟代碼'), h('div', { className: 'mcp-field-desc' }, '遇到安全驗證挑戰時填寫')),
              h('input', {
                className: 'mcp-input',
                value: config.twoFactorCode || '',
                placeholder: '6 位數雙重驗證代碼',
                onChange: (e) => updateConfig('twoFactorCode', e.target.value),
              })
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, 'Proxy 代理 URL'), h('div', { className: 'mcp-field-desc' }, '防止風控 (http:// 或 socks5://)')),
              h('input', {
                className: 'mcp-input',
                value: config.proxyUrl || '',
                placeholder: '例如: http://127.0.0.1:7890',
                onChange: (e) => updateConfig('proxyUrl', e.target.value),
              })
            )
          ),

        // TAB 3: 進階參數
        tab === 'env' &&
          h(
            'div',
            { className: 'mcp-card' },
            h('div', { className: 'mcp-card-title' }, h(Icon.Shield), '環境與生命週期參數'),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, '自訂 Python 執行檔路徑'), h('div', { className: 'mcp-field-desc' }, '留空則自動使用內建虛擬環境')),
              h('input', {
                className: 'mcp-input',
                value: config.pythonPath || '',
                placeholder: '例如: C:\\Python311\\python.exe',
                onChange: (e) => updateConfig('pythonPath', e.target.value),
              })
            ),
            h(
              'div',
              { className: 'mcp-field-row' },
              h('div', null, h('div', { className: 'mcp-field-label' }, 'Session 快取相對路徑'), h('div', { className: 'mcp-field-desc' }, '預設為 data/ig_session.json')),
              h('input', {
                className: 'mcp-input',
                value: config.sessionPath || '',
                placeholder: 'data/ig_session.json',
                onChange: (e) => updateConfig('sessionPath', e.target.value),
              })
            ),
            h(
              'div',
              { className: 'mcp-switch-box' },
              h(
                'div',
                null,
                h('div', { style: { fontSize: '13px', fontWeight: 500, color: '#ffffff' } }, '自動啟動 FastMCP 子進程'),
                h('div', { style: { fontSize: '11px', color: '#64748b' } }, 'DSH 啟動時自動初始化 Python 環境並常駐運行')
              ),
              h(
                'button',
                {
                  className: `mcp-toggle-btn ${config.autoStart !== false ? 'on' : ''}`,
                  onClick: () => updateConfig('autoStart', config.autoStart === false),
                },
                h('span', { className: 'mcp-toggle-thumb' })
              )
            )
          ),

        // 底部動作列
        h(
          'div',
          { className: 'mcp-action-bar' },
          h(
            'div',
            { className: `mcp-action-status ${saveNotice ? saveNotice.type : isDirty ? 'dirty' : ''}` },
            saveNotice
              ? (saveNotice.type === 'saved' ? h(Icon.Check) : null)
              : isDirty
              ? '※ 有尚未儲存的參數變更'
              : '',
            saveNotice ? saveNotice.text : ''
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            h(
              'button',
              {
                className: 'mcp-btn',
                onClick: loadData,
                disabled: saving,
              },
              '放棄變更'
            ),
            h(
              'button',
              {
                className: 'mcp-btn mcp-btn-primary',
                onClick: handleSave,
                disabled: saving,
              },
              saving ? h(Icon.Refresh, { spinning: true }) : h(Icon.Check),
              saving ? '儲存中...' : '儲存變更'
            )
          )
        )
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 注入專屬 CSS
        try {
          if (!document.querySelector('style[data-plugin-css="dsh-instagram-mcp"]')) {
            const style = document.createElement('style')
            style.setAttribute('data-plugin-css', 'dsh-instagram-mcp')
            style.textContent = CSS
            document.head.appendChild(style)
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => () => style.remove(), 'dsh-instagram-mcp: style')
            }
          }
        } catch (e) {}

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // 1. 左側一級專屬導航槽位 (settings.section)
        const registerSection = () => {
          try {
            slots.register(
              {
                name: 'settings.section',
                id: 'instagram-mcp',
                order: 34,
                label: 'Instagram MCP',
              },
              () => h(McpPanel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-mcp] 註冊 settings.section 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('settings.section', registerSection)
        } else if (typeof slots.register === 'function') {
          registerSection()
        }

        // 2. 外掛程式頁面頂部頁籤 (settings.plugins.tab)
        const registerTab = () => {
          try {
            slots.register(
              {
                name: 'settings.plugins.tab',
                id: 'instagram-mcp',
                order: 34,
                label: 'Instagram MCP',
              },
              () => h(McpPanel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-mcp] 註冊 settings.plugins.tab 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('settings.plugins.tab', registerTab)
        } else if (typeof slots.register === 'function') {
          registerTab()
        }

        // 3. 外掛程式卡片列表槽位 (plugins.item)
        const registerItem = () => {
          try {
            slots.register(
              {
                name: 'plugins.item',
                id: 'instagram-mcp',
                order: 34,
                label: 'Instagram FastMCP 核心服務',
              },
              () => h(McpPanel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-mcp] 註冊 plugins.item 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('plugins.item', registerItem)
        } else if (typeof slots.register === 'function') {
          registerItem()
        }
      },
    }
  },
})
