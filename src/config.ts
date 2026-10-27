/**
 * src/config.ts —— Instagram MCP Plugin 配置定義
 */

export interface InstagramMcpConfig {
  pythonPath?: string
  sessionPath?: string
  username?: string
  password?: string
  twoFactorCode?: string
  proxyUrl?: string
  autoStart?: boolean
}

export const defaultMcpConfig: InstagramMcpConfig = {
  sessionPath: 'data/ig_session.json',
  autoStart: true,
}

export function unwrapMcpValue<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback
  if (val === '[object Object]') return fallback
  if (typeof val === 'object' && typeof val.get === 'function') {
    const v = val.get()
    return (v !== undefined && v !== null && typeof v !== 'object') ? v : fallback
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return fallback
  }
  return val as T
}

export function sanitizeMcpConfig(raw: any): InstagramMcpConfig {
  const c = raw || {}
  return {
    pythonPath: unwrapMcpValue(c.pythonPath, ''),
    sessionPath: unwrapMcpValue(c.sessionPath, defaultMcpConfig.sessionPath) || 'data/ig_session.json',
    username: unwrapMcpValue(c.username, ''),
    password: unwrapMcpValue(c.password, ''),
    twoFactorCode: unwrapMcpValue(c.twoFactorCode, ''),
    proxyUrl: unwrapMcpValue(c.proxyUrl, ''),
    autoStart: unwrapMcpValue(c.autoStart, true),
  }
}

export function buildMcpConfigSchema(z: any) {
  return z.object({
    pythonPath: z
      .string()
      .description('指定 Python 3 執行檔路徑 (留空則使用自動偵測或內建虛擬環境)'),
    sessionPath: z
      .string()
      .default('data/ig_session.json')
      .description('Instagram Session 快取持久化檔案相對路徑'),
    username: z.string().description('Instagram 使用者帳號 (登入用)'),
    password: z.string().description('Instagram 密碼 (已有 Session 時可留空)'),
    twoFactorCode: z.string().description('2FA 雙步驟驗證代碼 (遇到挑戰時填入)'),
    proxyUrl: z.string().description('HTTP/SOCKS5 代理伺服器 URL (防風控)'),
    autoStart: z.boolean().default(true).description('是否在插件載入時自動啟動 FastMCP 子進程'),
  })
}
