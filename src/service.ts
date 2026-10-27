/**
 * src/service.ts —— Cordis Service 定義 (instagramMcp)
 */

import { InstagramMcpClient } from './lib/mcp.js'
import { InstagramMcpConfig } from './config.js'

export class InstagramMcpService {
  public client: InstagramMcpClient | null = null
  public loginStatus: {
    ok: boolean
    message: string
    method?: string
    username?: string
    user_id?: string
    sessionPath?: string
  } = {
    ok: false,
    message: '未連線或尚未檢查',
  }
  public config: InstagramMcpConfig

  constructor(config: InstagramMcpConfig) {
    this.config = config
  }

  public get isReady(): boolean {
    return Boolean(this.client && this.client.ready)
  }

  public getClient(): InstagramMcpClient {
    if (!this.client || !this.client.ready) {
      throw new Error('Instagram FastMCP 尚未就緒，請確認子進程是否啟動且登入。')
    }
    return this.client
  }

  public setClient(client: InstagramMcpClient | null) {
    this.client = client
  }

  public setLoginStatus(status: {
    ok: boolean
    message: string
    method?: string
    username?: string
    user_id?: string
    sessionPath?: string
  }) {
    this.loginStatus = status
  }
}
