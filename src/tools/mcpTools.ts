/**
 * src/tools/mcpTools.ts —— 向 DSH ctx.tools 註冊 Instagram MCP 標準工具
 */

import { InstagramMcpClient } from '../lib/mcp.js'
import { InstagramMcpConfig } from '../config.js'

export function registerMcpTools(
  ctx: any,
  config: InstagramMcpConfig,
  getMcpClient: () => InstagramMcpClient | null,
  getLoginStatus: () => { ok: boolean; message: string; method?: string },
  log: (msg: string) => void
) {
  const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined) || ctx.tools

  const register = (toolDef: any) => {
    const enriched = {
      ...toolDef,
      output: {
        schema: { type: 'object' },
        render: (_args: any, value: any) => [
          {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
          },
        ],
      },
    }
    try {
      if (typeof tools?.define === 'function') {
        tools.define(enriched)
      } else if (typeof tools?.register === 'function') {
        tools.register(enriched)
      } else if (typeof ctx?.tool === 'function') {
        ctx.tool(enriched)
      }
    } catch (e: any) {
      log(`註冊工具 ${toolDef.name} 失敗: ${e.message}`)
    }
  }

  // 1. 檢查狀態
  register({
    name: 'ig_check_status',
    description: '檢查 Instagram FastMCP 伺服器連線狀態與目前 Session 登入情形。',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const client = getMcpClient()
      const status = getLoginStatus()
      return {
        mcpRunning: Boolean(client?.isRunning),
        mcpReady: Boolean(client?.ready),
        loginStatus: status,
      }
    },
  })

  // 2. 登入或 Session 驗證
  register({
    name: 'ig_login',
    description: '執行 Instagram 帳號登入或驗證/重新載入本地 Session 快取。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Instagram 使用者名稱' },
        password: { type: 'string', description: 'Instagram 登入密碼' },
        two_factor_code: { type: 'string', description: '2FA 雙步驟驗證碼 (可選)' },
        proxy_url: { type: 'string', description: '代理伺服器 URL (可選)' },
      },
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) {
        return { ok: false, error: 'FastMCP 伺服器尚未就緒，請稍後重試。' }
      }
      const safe = (v: any, fallback = ''): string => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object' && typeof v.get === 'function') {
          const u = v.get()
          return typeof u === 'string' ? u : fallback
        }
        return fallback
      }
      return await client.igLogin({
        username: safe(args?.username, safe(config.username, '')),
        password: safe(args?.password, safe(config.password, '')),
        session_path: safe(config.sessionPath, 'data/ig_session.json') || 'data/ig_session.json',
        two_factor_code: safe(args?.two_factor_code, safe(config.twoFactorCode, '')),
        proxy_url: safe(args?.proxy_url, safe(config.proxyUrl, '')),
      })
    },
  })

  // 3. 搜尋標籤貼文
  register({
    name: 'ig_search_hashtag',
    description: '搜尋指定 Hashtag 標籤的最新或精選貼文列表。',
    parameters: {
      type: 'object',
      properties: {
        hashtag: { type: 'string', description: '標籤名稱（如 tech, ai，不需加 #）' },
        limit: { type: 'number', description: '獲取貼文數量上限 (預設 10)' },
      },
      required: ['hashtag'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igSearchHashtag(args.hashtag, args.limit || 10)
    },
  })

  // 4. 取得貼文內文與相鄰留言上下文
  register({
    name: 'ig_get_post_context',
    description: '抓取指定 Instagram 貼文的完整標題、發布者資訊與相鄰留言上下文。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文 PK 代碼' },
        comment_limit: { type: 'number', description: '抓取留言數量上限 (預設 10)' },
      },
      required: ['media_pk'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetPostContext(args.media_pk, args.comment_limit || 10)
    },
  })

  // 5. 發表留言或回覆
  register({
    name: 'ig_post_comment',
    description: '在特定貼文下發表新留言，或針對某留言進行巢狀回覆。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文 PK' },
        text: { type: 'string', description: '留言內容' },
        reply_to_comment_pk: { type: 'string', description: '要回覆的父留言 PK (可選)' },
      },
      required: ['media_pk', 'text'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igPostComment({
        media_pk: args.media_pk,
        text: args.text,
        reply_to_comment_pk: args.reply_to_comment_pk,
      })
    },
  })

  // 6. 讀取未讀私訊線程
  register({
    name: 'ig_get_unread_dms',
    description: '讀取未讀或最新的 Instagram Direct Messages (私訊) 對話線程。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最大取得對話線程數量 (預設 10)' },
      },
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetUnreadDms(args.limit || 10)
    },
  })

  // 7. 發送私訊
  register({
    name: 'ig_send_dm',
    description: '發送 Instagram Direct Message 私訊給指定對話線程。',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: '私訊線程 ID' },
        text: { type: 'string', description: '訊息文字內容' },
      },
      required: ['thread_id', 'text'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igSendDm({
        thread_id: args.thread_id,
        text: args.text,
      })
    },
  })

  // 8. 取得動態牆 (Timeline/Explore Feed)
  register({
    name: 'ig_get_timeline_feed',
    description: '獲取 Instagram 動態牆 (Timeline Feed) 或推薦貼文列表，供滾動瀏覽使用。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '獲取數量 (預設 10)' },
      },
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetTimelineFeed(args.limit || 10)
    },
  })

  // 9. 貼文點讚
  register({
    name: 'ig_like_media',
    description: '對指定的 Instagram 貼文按讚。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文 PK 代碼' },
      },
      required: ['media_pk'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igLikeMedia(args.media_pk)
    },
  })

  // 10. 指定帳號讀取最新貼文與影片 (純瀏覽、安全唯讀不發文)
  register({
    name: 'ig_get_user_medias',
    description: '指定 Instagram 帳號 (例如 wired, techcrunch, verge 等) 讀取其最新發布的貼文與影片列表，回傳包含完整資訊、媒體類型（圖片/影片/Reel/輪播）與聯名作者標示。純瀏覽，不發文、不點讚。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Instagram 使用者名稱（可不加 @）' },
        limit: { type: 'number', description: '獲取數量 (預設 10)' },
      },
      required: ['username'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetUserMedias(args.username, args.limit || 10)
    },
  })

  // 11. 指定帳號讀取連續短片 (Reels)
  register({
    name: 'ig_get_user_clips',
    description: '指定 Instagram 帳號專門讀取其連續短片 (Reels / Clips) 列表。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Instagram 使用者名稱（可不加 @）' },
        limit: { type: 'number', description: '獲取短片數量 (預設 10)' },
      },
      required: ['username'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetUserClips(args.username, args.limit || 10)
    },
  })

  // 12. 探索與熱門短影音 (Reels Feed)
  register({
    name: 'ig_get_reels_feed',
    description: '瀏覽熱門或探索連續短片 (Reels) 與短影音，適合刷影片與快速了解最新短影音潮流。純瀏覽。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '獲取數量 (預設 10)' },
      },
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetReelsFeed(args.limit || 10)
    },
  })

  // 13. 搜尋 Instagram 用戶
  register({
    name: 'ig_search_users',
    description: '搜尋 Instagram 使用者帳號，檢索官方帳號、ID 與頭像。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '帳號關鍵字或搜尋字串' },
        limit: { type: 'number', description: '獲取數量 (預設 10)' },
      },
      required: ['query'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igSearchUsers(args.query, args.limit || 10)
    },
  })

  // 14. 搜尋 Instagram 標籤
  register({
    name: 'ig_search_tags',
    description: '搜尋 Instagram 相關標籤（Hashtag）名稱與貼文數。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '標籤關鍵字 (如 ai, tech)' },
        limit: { type: 'number', description: '獲取數量 (預設 10)' },
      },
      required: ['query'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igSearchTags(args.query, args.limit || 10)
    },
  })

  log('✅ 已註冊 14 個 Instagram MCP 核心工具至 DSH Tools！')
}
