/**
 * src/index.ts —— DSH Instagram FastMCP 核心服務插件入口
 * ============================================================================
 * 職責：
 * 1. 導出標準 Cordis 插件結構 (name, inject, Config, apply)。
 * 2. 註冊與維護 Instagram FastMCP 服務單例 (getSharedMcpService / getSharedMcpClient)，
 *    供其他外掛 (dsh-instagram-plugin, dsh-instagram-scroll 等) 安全共享底層 FastMCP 連線與 Session，
 *    完全免除 Cordis 的 property access 拋錯。
 * 3. 立即向 DSH Tools 註冊標準 Instagram 工具集 (ig_login, ig_search_hashtag, 等)。
 * 4. 管理 Python 獨立虛擬環境與 FastMCP 子進程生命週期。
 * ============================================================================
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMcpConfigSchema, defaultMcpConfig, InstagramMcpConfig, sanitizeMcpConfig } from './config.js'
import { loadSchemastery } from './lib/hostdeps.js'
import { ensurePythonEnv } from './lib/env.js'
import { InstagramMcpClient } from './lib/mcp.js'
import { registerMcpTools } from './tools/mcpTools.js'
import { InstagramMcpService } from './service.js'

export * from './types.js'
export * from './config.js'
export * from './lib/mcp.js'
export * from './lib/env.js'
export * from './service.js'

// 全局單例共享機制 (跨模組與全域保證零拋錯存取)
let sharedService: InstagramMcpService | null = null

export function getSharedMcpService(): InstagramMcpService | null {
  if (sharedService) return sharedService
  return (globalThis as any).__DSH_INSTAGRAM_MCP__ || null
}

export function setSharedMcpService(svc: InstagramMcpService | null) {
  sharedService = svc
  ;(globalThis as any).__DSH_INSTAGRAM_MCP__ = svc
}

export function getSharedMcpClient(): InstagramMcpClient | null {
  return getSharedMcpService()?.client || null
}

export const name = 'instagram-mcp'
export const inject = ['tools', 'webServer']

// 載入 schemastery
const zInstance = await loadSchemastery()
export const Config = buildMcpConfigSchema(zInstance)

export function apply(ctx: any, userConfig: Partial<InstagramMcpConfig> = {}) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const dataDir = join(pluginRoot, 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const configFile = join(dataDir, 'config.json')
  const localSavedConfig = (() => {
    try {
      if (existsSync(configFile)) {
        return JSON.parse(readFileSync(configFile, 'utf-8'))
      }
    } catch {}
    return {}
  })()

  let activeConfig: InstagramMcpConfig = sanitizeMcpConfig({
    ...defaultMcpConfig,
    ...userConfig,
    ...localSavedConfig,
  })

  // 若 config.json 尚不存在，動態創建初始配置檔
  if (!existsSync(configFile)) {
    try {
      writeFileSync(configFile, JSON.stringify(activeConfig, null, 2), 'utf-8')
    } catch {}
  }

  // 確保 sessionPath 所在資料夾與 session 初始檔案動態建立
  const sessionAbsPath = join(pluginRoot, activeConfig.sessionPath || 'data/ig_session.json')
  const sessionDir = dirname(sessionAbsPath)
  if (!existsSync(sessionDir)) {
    try {
      mkdirSync(sessionDir, { recursive: true })
    } catch {}
  }
  if (!existsSync(sessionAbsPath)) {
    try {
      writeFileSync(sessionAbsPath, '{}', 'utf-8')
    } catch {}
  }

  const log = (msg: string) => {
    console.log(`[IG-MCP] ${msg}`)
  }

  log(`Instagram FastMCP 插件初始化中... (路徑: ${pluginRoot})`)

  // 1. 初始化並綁定單例服務
  const service = new InstagramMcpService(activeConfig)
  setSharedMcpService(service)

  try {
    if (typeof ctx?.provide === 'function') {
      ctx.provide('instagramMcp')
      ctx.instagramMcp = service
    }
  } catch {}

  let mcpClient: InstagramMcpClient | null = null
  let isDisposed = false

  // 2. 立即註冊 Tools 給主模型與其他插件
  registerMcpTools(
    ctx,
    activeConfig,
    () => mcpClient,
    () => service.loginStatus,
    log
  )

  // 3. 異步啟動 Python 子進程與 FastMCP 伺服器
  const initEngine = async () => {
    try {
      log('檢查 Python 虛擬環境...')
      const envRes = await ensurePythonEnv(pluginRoot, activeConfig.pythonPath, log)
      if (!envRes.ok) {
        service.setLoginStatus({
          ok: false,
          message: `Python 虛擬環境未就緒: ${envRes.error}`,
        })
        log(`❌ ${service.loginStatus.message}`)
        return
      }

      if (isDisposed) return

      const serverScript = join(pluginRoot, 'vendor', 'instagram-mcp', 'server.py')
      mcpClient = new InstagramMcpClient({
        pythonPath: envRes.pythonPath,
        serverScriptPath: serverScript,
        cwd: join(pluginRoot, 'vendor', 'instagram-mcp'),
        log: (m) => log(`[Engine] ${m}`),
      })

      await mcpClient.start()
      service.setClient(mcpClient)
      log('✅ Python FastMCP 伺服器握手成功！')

      // 4. 若已配置登入資訊或存在 Session 快取，嘗試登入
      const sessFile = join(pluginRoot, activeConfig.sessionPath || 'data/ig_session.json')
      const loginRes = await mcpClient.igLogin({
        username: activeConfig.username,
        password: activeConfig.password,
        session_path: sessFile,
        two_factor_code: activeConfig.twoFactorCode,
        proxy_url: activeConfig.proxyUrl,
      })

      if (loginRes?.ok) {
        const loggedUser = loginRes.username || activeConfig.username || ''
        service.setLoginStatus({
          ok: true,
          method: loginRes.method,
          username: loggedUser,
          user_id: loginRes.user_id,
          sessionPath: sessFile,
          message: `已登入 (${loginRes.method === 'session' ? 'Session 快取' : '帳號密碼'}) - @${loggedUser}`,
        })
        log(`🎉 Instagram 登入就緒！${service.loginStatus.message}`)
      } else {
        service.setLoginStatus({
          ok: false,
          sessionPath: sessFile,
          message: loginRes?.message || '等待登入或驗證憑證',
        })
        log(`ℹ️ ${service.loginStatus.message}`)
      }
    } catch (err: any) {
      service.setLoginStatus({
        ok: false,
        message: `FastMCP 啟動異常: ${err.message}`,
      })
      log(`❌ FastMCP 異常: ${err.message}`)
    }
  }

  if (activeConfig.autoStart !== false) {
    initEngine().catch((e) => log(`initEngine unhandled error: ${e.message}`))
  }

  // ==========================================================================
  // WebServer API 註冊 (提供 client.js 設定面板讀寫與狀態查詢)
  // ==========================================================================
  const sendJson = (res: any, status: number, data: any) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(data))
  }

  const readBody = (req: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: any) => (body += chunk))
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  }

  const handleMcpRequest = async (req: any, res: any) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const pathname = url.pathname

      // 讀取當前 FastMCP 配置
      if (req.method === 'GET' && pathname === '/api/instagram/mcp/config') {
        return sendJson(res, 200, { ok: true, config: activeConfig })
      }

      // 更新並持久化 FastMCP 配置
      if (req.method === 'POST' && pathname === '/api/instagram/mcp/config') {
        const body = await readBody(req)
        activeConfig = sanitizeMcpConfig({ ...activeConfig, ...body })
        try {
          writeFileSync(configFile, JSON.stringify(activeConfig, null, 2), 'utf-8')
        } catch (e) {
          console.error('[IG-MCP] 儲存 config.json 失敗:', e)
        }
        return sendJson(res, 200, { ok: true, config: activeConfig })
      }

      // 讀取 FastMCP 服務運行狀態
      if (req.method === 'GET' && pathname === '/api/instagram/mcp/status') {
        const sessFile = join(pluginRoot, activeConfig.sessionPath || 'data/ig_session.json')
        let antiRisk: any = null
        if (mcpClient?.ready) {
          try {
            const ar = await mcpClient.igGetAntiRiskStatus()
            if (ar?.ok) antiRisk = ar.anti_risk
          } catch {}
        }
        return sendJson(res, 200, {
          ok: true,
          mcpRunning: Boolean(mcpClient?.isRunning),
          mcpReady: Boolean(mcpClient?.ready),
          loginStatus: service.loginStatus,
          sessionExists: existsSync(sessFile),
          sessionPath: activeConfig.sessionPath,
          pythonPath: activeConfig.pythonPath,
          antiRisk,
        })
      }

      // 手動重設防風控熔斷
      if (req.method === 'POST' && pathname === '/api/instagram/mcp/reset-cooldown') {
        if (!mcpClient || !mcpClient.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 尚未就緒' })
        }
        const resetRes = await mcpClient.igResetAntiRiskCooldown()
        return sendJson(res, 200, resetRes)
      }

      // 重啟 FastMCP 子進程
      if (req.method === 'POST' && pathname === '/api/instagram/mcp/restart') {
        log('收到重啟 FastMCP 請求，正在關閉舊子進程...')
        if (mcpClient) {
          await mcpClient.stop().catch(() => {})
          mcpClient = null
          service.setClient(null)
        }
        await initEngine()
        return sendJson(res, 200, {
          ok: true,
          message: 'FastMCP 服務已重啟',
          loginStatus: service.loginStatus,
        })
      }

      // 測試登入
      if (req.method === 'POST' && pathname === '/api/instagram/mcp/login') {
        const body = await readBody(req)
        const sessFile = join(pluginRoot, activeConfig.sessionPath || 'data/ig_session.json')
        if (!mcpClient || !mcpClient.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 尚未就緒' })
        }
        const loginRes = await mcpClient.igLogin({
          username: body.username || activeConfig.username,
          password: body.password || activeConfig.password,
          session_path: sessFile,
          two_factor_code: body.twoFactorCode || activeConfig.twoFactorCode,
          proxy_url: body.proxyUrl || activeConfig.proxyUrl,
        })
        if (loginRes?.ok) {
          const loggedUser = loginRes.username || activeConfig.username || body.username || ''
          service.setLoginStatus({
            ok: true,
            method: loginRes.method,
            username: loggedUser,
            user_id: loginRes.user_id,
            sessionPath: sessFile,
            message: `已登入 (${loginRes.method === 'session' ? 'Session 快取' : '帳號密碼'}) - @${loggedUser}`,
          })
        } else {
          service.setLoginStatus({
            ok: false,
            sessionPath: sessFile,
            message: loginRes?.message || '登入失敗',
          })
        }
        return sendJson(res, 200, { ok: Boolean(loginRes?.ok), loginStatus: service.loginStatus, result: loginRes })
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (e: any) {
      return sendJson(res, 500, { ok: false, error: e.message })
    }
  }

  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
  if (webServer) {
    try {
      if (typeof webServer.register === 'function') {
        webServer.register({
          kind: 'prefix',
          path: '/api/instagram/mcp',
          handler: handleMcpRequest,
        })
        log('✅ 已註冊 FastMCP Web API 路由: /api/instagram/mcp')
      }
    } catch (e: any) {
      log(`註冊 Web API 異常: ${e.message}`)
    }
  }

  // 4. 優雅卸載清理
  const dispose = async () => {
    isDisposed = true
    if (mcpClient) {
      await mcpClient.stop().catch(() => {})
      mcpClient = null
      service.setClient(null)
    }
    setSharedMcpService(null)
    log('插件已成功卸載。')
  }

  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', dispose)
  }
}

export default {
  name,
  inject,
  Config,
  apply,
}
