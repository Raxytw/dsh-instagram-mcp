/**
 * src/tools/mcpTools.ts —— 向 DSH ctx.tools 註冊 Instagram MCP 標準工具
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { InstagramMcpClient } from '../lib/mcp.js'
import { InstagramMcpConfig } from '../config.js'

function getFishMemoryDir(): string {
  const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh')
  return join(dshHome, 'fish-memory')
}

function sanitizeMemoryText(raw: string, maxLen = 500): string {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\s*\/?\s*(?:system|instruction|prompt|developer|assistant|tool_call|function_call)[^>]*>/gi, '[TAG]')
    .replace(/(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?|忽略(?:上述|前面|之前|所有)(?:所有)?(?:指令|規則|設定|限制))/gi, '[FILTERED]')
    .trim()
    .slice(0, maxLen)
}

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
    description: '檢查 Instagram FastMCP 伺服器連線狀態、Session 登入情形與防風控熔斷冷卻狀態。',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const client = getMcpClient()
      const status = getLoginStatus()
      let antiRisk: any = null
      if (client?.ready) {
        try {
          const ar = await client.igGetAntiRiskStatus()
          if (ar?.ok) antiRisk = ar.anti_risk
        } catch {}
      }
      return {
        mcpRunning: Boolean(client?.isRunning),
        mcpReady: Boolean(client?.ready),
        loginStatus: status,
        antiRisk,
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

  // 3.5 模糊搜尋貼文與短片 (推薦優先使用)
  register({
    name: 'ig_fuzzy_search_posts',
    description: '模糊搜尋 Instagram 貼文與連續短片 (結合綜合關鍵字 SERP、Reels 搜尋與相關創作者貼文，解決單純 Hashtag 標籤搜尋返回 0 則貼文的問題)。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '模糊搜尋關鍵字（如 ai, deepseek, coding, tech 等）' },
        limit: { type: 'number', description: '獲取貼文數量上限 (預設 10)' },
      },
      required: ['query'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igFuzzySearchPosts(args.query, args.limit || 10)
    },
  })

  // 4. 取得貼文或 Reel 內文與相鄰留言上下文
  register({
    name: 'ig_get_post_context',
    description: '抓取指定 Instagram 貼文或 Reel 的完整內文、標題、無障礙視覺描述、音訊資訊、字幕與相鄰留言（含子留言）上下文。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文或 Reel PK 代碼' },
        comment_limit: { type: 'number', description: '抓取留言數量上限 (預設 15)' },
      },
      required: ['media_pk'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetPostContext(args.media_pk, args.comment_limit || 15)
    },
  })

  // 4.5 取得近期提及 (@mention) 通知清單
  register({
    name: 'ig_get_recent_mentions',
    description: '從 Instagram 通知收件匣 (news/inbox) 取得近期提及 (@mention) 或回覆機器人的貼文與 Reel PK 清單。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最大取得提及通知數量 (預設 20)' },
      },
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetRecentMentions(args.limit || 20)
    },
  })

  // 5. 發表留言或回覆（支援傳送圖片到 RM）
  register({
    name: 'ig_post_comment',
    description: '在特定貼文下發表新留言，或針對某留言進行巢狀回覆（RM），並支援附帶傳送圖片給目標用戶。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文 PK' },
        text: { type: 'string', description: '留言內容' },
        reply_to_comment_pk: { type: 'string', description: '要回覆的父留言 PK (可選)' },
        image_path: { type: 'string', description: '選填，欲傳送到 RM 的本地圖片路徑或 data:image/...;base64' },
        image_url: { type: 'string', description: '選填，欲傳送到 RM 的遠端圖片 URL 或 data:image/...;base64' },
        target_username: { type: 'string', description: '選填，RM 互動的目標 Instagram 帳號' },
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
        image_path: args.image_path,
        image_url: args.image_url,
        target_username: args.target_username,
      })
    },
  })

  // 6. 讀取未讀私訊線程
  register({
    name: 'ig_get_unread_dms',
    description: '讀取未讀或最新的 Instagram Direct Messages (私訊) 對話線程（包含圖片、文件與分享貼文/Reel 內容）。',
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

  // 7. 發送私訊（支援文字、圖片與檔案）
  register({
    name: 'ig_send_dm',
    description: '發送 Instagram Direct Message 私訊（支援文字、圖片與檔案）給指定對話線程。',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: '私訊線程 ID' },
        text: { type: 'string', description: '訊息文字內容' },
        image_path: { type: 'string', description: '選填，本地圖片路徑或 data:image/...;base64' },
        image_url: { type: 'string', description: '選填，遠端圖片 URL 或 data:image/...;base64' },
        file_path: { type: 'string', description: '選填，本地檔案路徑' },
      },
      required: ['thread_id', 'text'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igSendDm({
        thread_id: args.thread_id,
        text: args.text,
        image_path: args.image_path,
        image_url: args.image_url,
        file_path: args.file_path,
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

  // 15. 查詢防風控狀態
  register({
    name: 'ig_get_anti_risk_status',
    description: '查詢 Instagram 防風控安全狀態（熔斷冷卻倒數、最近一小時寫入次數、安全建議等）。',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igGetAntiRiskStatus()
    },
  })

  // 16. 手動解除防風控熔斷
  register({
    name: 'ig_reset_anti_risk_cooldown',
    description: '手動解除防風控熔斷冷卻狀態（僅在確認 Instagram 官方功能限制已解除後調用）。',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igResetAntiRiskCooldown()
    },
  })

  // 17. 轉發貼文或連續短片 (Repost Media to Story / Feed / DM)
  register({
    name: 'ig_repost_media',
    description: '轉發指定的 Instagram 貼文或 Reel（支援限時動態 Story 卡片轉發、動態牆/Reels 貼文轉發、或私訊 DM 卡片轉發），可在轉發文案中 @ 用戶並附上對該貼文/Reel 內容的感想。',
    parameters: {
      type: 'object',
      properties: {
        media_pk: { type: 'string', description: '貼文/Reel 的 PK、Shortcode 或完整 Instagram 網址' },
        caption: { type: 'string', description: '轉發文案（可包含 @用戶 與對該 Reel/貼文的感想）' },
        repost_mode: {
          type: 'string',
          enum: ['story', 'feed', 'dm'],
          description: '轉發方式：story (限時動態卡片，預設)、feed (動態牆/Reels 貼文)、dm (私訊卡片)',
        },
        mention_users: {
          type: 'array',
          items: { type: 'string' },
          description: '要在轉發中標註 (@) 的 Instagram 帳號清單（不需加 @）',
        },
      },
      required: ['media_pk'],
    },
    execute: async (args: any) => {
      const client = getMcpClient()
      if (!client || !client.ready) return { ok: false, error: 'FastMCP 尚未就緒' }
      return await client.igRepostMedia({
        media_pk: String(args.media_pk || ''),
        caption: String(args.caption || ''),
        repost_mode: args.repost_mode || 'story',
        mention_users: Array.isArray(args.mention_users) ? args.mention_users : [],
      })
    },
  })

  // 18. 讀寫 dsh-fish-memory 記憶庫 (支援 DM / RM 對話紀錄與刷 Reel / 貼文感想寫入與讀取)
  register({
    name: 'ig_fish_memory',
    description: '讀取或寫入 dsh-fish-memory 記憶庫，支援記錄或檢索 Instagram DM/RM 聊天紀錄、以及刷 Reel 與貼文的感想內容（具備社交隔離與防注入保護）。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write'],
          description: '操作類型：read (讀取記憶) 或 write (寫入記憶)',
        },
        category: {
          type: 'string',
          enum: ['dm', 'rm', 'thought'],
          description: '記憶分類：dm (私訊紀錄)、rm (貼文 @ 提及留言紀錄)、thought (刷 Reel 或貼文的感想內容)',
        },
        username: {
          type: 'string',
          description: '互動對象 Instagram 帳號（若為刷貼文感想可不填，預設使用主人帳號）',
        },
        user_text: {
          type: 'string',
          description: '寫入時：對方說的話，或被刷到的貼文/Reel 標題與內容摘要',
        },
        bot_reply: {
          type: 'string',
          description: '寫入時：機器人回覆的話，或對該 Reel/貼文的感想內容',
        },
        media_pk: {
          type: 'string',
          description: '選填，關聯的貼文或 Reel PK / 網址',
        },
        limit: {
          type: 'number',
          description: '讀取時回傳的最大筆數 (預設 10)',
        },
      },
      required: ['action', 'category'],
    },
    execute: async (args: any) => {
      const memDir = getFishMemoryDir()
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })
      const cat = String(args.category || 'thought').toLowerCase()
      const cleanUser = String(args.username || config.masterUsername || config.username || 'general')
        .trim()
        .replace(/^@/, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_') || 'general'
      const fileName =
        cat === 'dm'
          ? `social_ig_dm_${cleanUser}.json`
          : cat === 'rm'
            ? `social_ig_rm_${cleanUser}.json`
            : `social_ig_thoughts_${cleanUser}.json`
      const filePath = join(memDir, fileName)

      if (args.action === 'write') {
        const now = Date.now()
        const safeInput = sanitizeMemoryText(args.user_text || '', 500)
        const safeThoughtOrReply = sanitizeMemoryText(args.bot_reply || '', 500)
        const mediaPk = sanitizeMemoryText(args.media_pk || '', 120)

        let doc: any = {
          sessionKey: `social_ig_${cat}_${cleanUser}`,
          channel: `instagram_${cat}`,
          username: cleanUser,
          isolatedFromMasterPrivateMemory: true,
          updatedAt: now,
          messages: [],
        }
        if (existsSync(filePath)) {
          try {
            doc = JSON.parse(readFileSync(filePath, 'utf-8'))
            if (!Array.isArray(doc.messages)) doc.messages = []
          } catch {}
        }

        if (cat === 'thought') {
          doc.messages.push(
            {
              role: 'user',
              content: `[刷IG貼文/Reel${mediaPk ? ` (${mediaPk})` : ''}] ${safeInput}`,
              timestamp: now - 1,
              mediaPk,
            },
            {
              role: 'assistant',
              content: safeThoughtOrReply,
              timestamp: now,
              mediaPk,
            }
          )
        } else {
          doc.messages.push(
            {
              role: 'user',
              content: `@${cleanUser}: ${safeInput}`,
              timestamp: now - 1,
              mediaPk,
            },
            {
              role: 'assistant',
              content: safeThoughtOrReply,
              timestamp: now,
              mediaPk,
            }
          )
        }
        if (doc.messages.length > 60) doc.messages = doc.messages.slice(-60)
        doc.updatedAt = now
        writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf-8')
        return { ok: true, action: 'write', category: cat, filePath, count: doc.messages.length }
      }

      const maxItems = Math.max(2, Math.min(40, Number(args.limit) || 10))
      if (!existsSync(filePath)) {
        return { ok: true, action: 'read', category: cat, messages: [] }
      }
      try {
        const doc = JSON.parse(readFileSync(filePath, 'utf-8'))
        const msgs = Array.isArray(doc?.messages) ? doc.messages.slice(-maxItems) : []
        return { ok: true, action: 'read', category: cat, username: cleanUser, messages: msgs }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    },
  })

  log('✅ 已註冊 18 個 Instagram MCP 核心工具（含貼文/Reel 轉發、圖片/文件傳收與 dsh-fish-memory 記憶讀寫）至 DSH Tools！')
}
