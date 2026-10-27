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
export const inject = ['tools']

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

  const activeConfig: InstagramMcpConfig = sanitizeMcpConfig({
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
      const sessionAbsPath = join(pluginRoot, activeConfig.sessionPath || 'data/ig_session.json')
      const loginRes = await mcpClient.igLogin({
        username: activeConfig.username,
        password: activeConfig.password,
        session_path: sessionAbsPath,
        two_factor_code: activeConfig.twoFactorCode,
        proxy_url: activeConfig.proxyUrl,
      })

      if (loginRes?.ok) {
        service.setLoginStatus({
          ok: true,
          method: loginRes.method,
          message: `已登入 (${loginRes.method === 'session' ? 'Session 快取' : '帳號密碼'}) - @${loginRes.username || activeConfig.username}`,
        })
        log(`🎉 Instagram 登入就緒！${service.loginStatus.message}`)
      } else {
        service.setLoginStatus({
          ok: false,
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
