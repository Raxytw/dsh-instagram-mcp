/**
 * src/lib/mcp.ts —— FastMCP 子進程通訊管理與強型別 Client
 */

import { ChildProcess, spawn } from 'node:child_process'
import {
  InstagramLoginResult,
  InstagramPost,
  InstagramPostContext,
  InstagramDmThread,
} from '../types.js'

export interface McpClientOptions {
  pythonPath: string
  serverScriptPath: string
  cwd: string
  log?: (msg: string) => void
}

export class InstagramMcpClient {
  private options: McpClientOptions
  private proc: ChildProcess | null = null
  private stdoutBuffer: string = ''
  private nextRequestId: number = 1
  private pendingRequests: Map<
    number | string,
    { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
  > = new Map()
  private isInitialized: boolean = false
  private stopping: boolean = false
  private restartTimer: NodeJS.Timeout | null = null
  private log: (msg: string) => void

  constructor(options: McpClientOptions) {
    this.options = options
    this.log = options.log || console.log
  }

  public get isRunning(): boolean {
    return this.proc !== null && !this.proc.killed
  }

  public get ready(): boolean {
    return this.isRunning && this.isInitialized
  }

  /**
   * 啟動 Python 子進程並完成 MCP initialize 握手
   */
  public async start(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.proc && !this.proc.killed) {
      return
    }
    this.stopping = false

    const { pythonPath, serverScriptPath, cwd } = this.options
    this.log(`[MCP Client] 啟動 Python FastMCP 子進程: ${pythonPath} ${serverScriptPath}`)

    this.proc = spawn(pythonPath, [serverScriptPath], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString('utf-8'))
    })

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf-8').trim()
      if (msg) this.log(`[Python stderr] ${msg}`)
    })

    this.proc.on('exit', (code, signal) => {
      this.log(`[MCP Client] 子進程退出 (code=${code}, signal=${signal})`)
      this.isInitialized = false
      this.proc = null
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timer)
        req.reject(new Error(`MCP 子進程異常退出 (code=${code})`))
      }
      this.pendingRequests.clear()
      this.scheduleRestart()
    })

    // 發送 MCP initialize 握手
    const initRes = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'dsh-instagram-mcp', version: '1.0.0' },
    })

    this.isInitialized = true
    this.log(`[MCP Client] 握手成功: ${JSON.stringify(initRes?.serverInfo || {})}`)

    // 發送 initialized 通知
    this.sendNotification('notifications/initialized', {})
  }

  private handleStdout(data: string) {
    this.stdoutBuffer += data
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed)
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!
          clearTimeout(req.timer)
          this.pendingRequests.delete(msg.id)
          if (msg.error) {
            req.reject(new Error(`MCP Error ${msg.error.code}: ${msg.error.message}`))
          } else {
            req.resolve(msg.result)
          }
        }
      } catch (e: any) {
        this.log(`[MCP JSON Parse Error] ${e.message} in line: ${trimmed.slice(0, 80)}`)
      }
    }
  }

  public async sendRequest(method: string, params: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (!this.proc || this.proc.killed) {
      throw new Error('MCP 子進程尚未啟動或已關閉')
    }

    const id = this.nextRequestId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`MCP 請求逾時 (${timeoutMs}ms) for ${method}`))
        }
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.proc?.stdin?.write(payload)
    })
  }

  public sendNotification(method: string, params: any = {}): void {
    if (!this.proc || this.proc.killed) return
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    this.proc.stdin?.write(payload)
  }

  public async callTool(name: string, args: Record<string, any> = {}, timeoutMs = 60000): Promise<any> {
    const res = await this.sendRequest('tools/call', { name, arguments: args }, timeoutMs)
    if (res?.content && Array.isArray(res.content)) {
      const textItem = res.content.find((c: any) => c.type === 'text')
      if (textItem?.text) {
        try {
          return JSON.parse(textItem.text)
        } catch {
          return textItem.text
        }
      }
    }
    return res
  }

  public async listTools(): Promise<any[]> {
    const res = await this.sendRequest('tools/list', {})
    return res?.tools || []
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start().catch((err: any) => {
        this.log(`[MCP Client] 子進程重啟失敗: ${err?.message || err}`)
      })
    }, 1500)
  }

  public async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.proc && !this.proc.killed) {
      this.log('[MCP Client] 正在停止 Python FastMCP 子進程...')
      this.proc.kill('SIGTERM')
      this.proc = null
      this.isInitialized = false
    }
  }

  // ==========================================================================
  // 高階 Instagram 業務 API 封裝
  // ==========================================================================

  public async igLogin(params: {
    username?: string
    password?: string
    session_path?: string
    two_factor_code?: string
    proxy_url?: string
  }): Promise<InstagramLoginResult> {
    const safeStr = (v: any, fallback = ''): string => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && typeof v.get === 'function') {
        const u = v.get()
        return typeof u === 'string' ? u : fallback
      }
      return fallback
    }

    const cleanParams = {
      username: safeStr(params?.username, ''),
      password: safeStr(params?.password, ''),
      session_path: safeStr(params?.session_path, 'data/ig_session.json') || 'data/ig_session.json',
      two_factor_code: safeStr(params?.two_factor_code, ''),
      proxy_url: safeStr(params?.proxy_url, ''),
    }

    return this.callTool('ig_login', cleanParams, 60000)
  }

  public async igSearchHashtag(hashtag: string, limit = 10): Promise<{ ok: boolean; hashtag: string; posts: InstagramPost[] }> {
    return this.callTool('ig_search_hashtag', { hashtag, limit }, 60000)
  }

  public async igFuzzySearchPosts(query: string, limit = 10): Promise<import('../types.js').InstagramFuzzySearchResult> {
    return this.callTool('ig_fuzzy_search_posts', { query, limit }, 75000)
  }

  public async igGetPostContext(media_pk: string, comment_limit = 15): Promise<InstagramPostContext> {
    return this.callTool('ig_get_post_context', { media_pk, comment_limit }, 45000)
  }

  public async igGetRecentMentions(limit = 20): Promise<import('../types.js').InstagramRecentMentionsResult> {
    return this.callTool('ig_get_recent_mentions', { limit }, 45000)
  }

  public async igPostComment(params: {
    media_pk: string
    text: string
    reply_to_comment_pk?: string
    jitter_min?: number
    jitter_max?: number
  }): Promise<{ ok: boolean; comment_pk?: string; error?: string; in_cooldown?: boolean; cooldown_remaining_sec?: number }> {
    return this.callTool('ig_post_comment', params, 45000)
  }

  public async igGetUnreadDms(limit = 10): Promise<{ ok: boolean; threads: InstagramDmThread[] }> {
    return this.callTool('ig_get_unread_dms', { limit }, 45000)
  }

  public async igSendDm(params: {
    thread_id: string
    text: string
    jitter_min?: number
    jitter_max?: number
  }): Promise<{ ok: boolean; message_id?: string; error?: string; in_cooldown?: boolean; cooldown_remaining_sec?: number }> {
    return this.callTool('ig_send_dm', params, 45000)
  }

  public async igGetUserMedias(username: string, limit = 10): Promise<import('../types.js').InstagramUserMediasResult> {
    return this.callTool('ig_get_user_medias', { username, limit }, 45000)
  }

  public async igGetUserClips(username: string, limit = 10): Promise<import('../types.js').InstagramUserClipsResult> {
    return this.callTool('ig_get_user_clips', { username, limit }, 45000)
  }

  public async igGetReelsFeed(limit = 10): Promise<{ ok: boolean; count: number; reels: InstagramPost[] }> {
    return this.callTool('ig_get_reels_feed', { limit }, 60000)
  }

  public async igSearchUsers(query: string, limit = 10): Promise<import('../types.js').InstagramSearchUsersResult> {
    return this.callTool('ig_search_users', { query, limit }, 30000)
  }

  public async igSearchTags(query: string, limit = 10): Promise<import('../types.js').InstagramSearchTagsResult> {
    return this.callTool('ig_search_tags', { query, limit }, 30000)
  }

  public async igGetTimelineFeed(limit = 10): Promise<{ ok: boolean; posts: InstagramPost[] }> {
    return this.callTool('ig_get_timeline_feed', { limit }, 75000)
  }

  public async igLikeMedia(media_pk: string): Promise<{ ok: boolean; media_pk: string; status?: string; error?: string; in_cooldown?: boolean; cooldown_remaining_sec?: number }> {
    return this.callTool('ig_like_media', { media_pk }, 30000)
  }

  public async igGetAntiRiskStatus(): Promise<{ ok: boolean; anti_risk: import('../types.js').InstagramAntiRiskStatus }> {
    return this.callTool('ig_get_anti_risk_status', {}, 20000)
  }

  public async igResetAntiRiskCooldown(): Promise<{ ok: boolean; message: string }> {
    return this.callTool('ig_reset_anti_risk_cooldown', {}, 20000)
  }
}

