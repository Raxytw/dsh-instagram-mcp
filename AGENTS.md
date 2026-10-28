# AGENTS.md — `@luoyi-dsh/instagram-mcp` 操作指南與工具調用規範

本文件為 AI Agent、DeepSeek Harness (DSH) 主模型與上層外掛（`@luoyi-dsh/instagram-plugin`、`@luoyi-dsh/instagram-scroll`）提供 `@luoyi-dsh/instagram-mcp` 的完整操作方法、MCP 工具清單、REST API 與跨插件單例介面說明。

---

## 🔑 1. 全域統一帳號設定原則

機器人 Instagram 帳號 (`username`) 與主人 Instagram 帳號 (`masterUsername`) **統一集中於 `@luoyi-dsh/instagram-mcp` 設定**。
上層插件 `dsh-instagram-plugin` 與 `dsh-instagram-scroll` 會透過全域單例自動讀取並沿用，無須重複設定。

---

## 🛠️ 2. 提供之標準 MCP 工具清單

| 工具名稱 | 說明 | 參數 |
| :--- | :--- | :--- |
| **`ig_check_status`** | 檢查 FastMCP 服務狀態、Session 登入情形與防風控熔斷冷卻倒數 | 無 |
| **`ig_login`** | 登入 Instagram 帳號或重新驗證 Session 快取 | `username`, `password`, `two_factor_code`, `proxy_url` |
| **`ig_fuzzy_search_posts`** | **模糊搜尋貼文與 Reels 短片**（結合 `top_serp`、`reels_serp` 與公開創作者貼文，解決單純 Hashtag 搜尋為 0 的問題） | `query` (string, 必填), `limit` (number, 預設 10) |
| **`ig_search_hashtag`** | 搜尋指定 Hashtag 標籤之最新貼文清單（內建模糊搜尋備援） | `hashtag` (string), `limit` (number) |
| **`ig_get_post_context`** | 抓取指定貼文或 Reel 之完整內文、標題、無障礙視覺描述 (`accessibility_caption`)、音訊配樂 (`audio_info`)、字幕 (`video_subtitles`)、附帶多模態圖片 (`image_urls`)、文件網址 (`file_urls`) 與留言（含巢狀子留言）上下文 | `media_pk` (string), `comment_limit` (number, 預設 15) |
| **`ig_get_recent_mentions`** | 從 Instagram 通知收件匣 (`news/inbox`) 探索近期提及 (`@mention`) 或回覆機器人的貼文與 Reel PK 清單 | `limit` (number, 預設 20) |
| **`ig_post_comment`** | 於指定貼文發表新留言，支援巢狀回覆與**傳送圖片至 RM**（透過附帶圖片連動發送） | `media_pk`, `text`, `reply_to_comment_pk`, `image_path`, `image_url`, `target_username`, `jitter_min`, `jitter_max` |
| **`ig_get_unread_dms`** | 讀取最新或未讀之 Instagram 私訊對話線程（支援讀取對話圖片與檔案） | `limit` (number) |
| **`ig_send_dm`** | 發送 Instagram Direct Message 私訊給特定線程，**支援發送圖片與文件** | `thread_id`, `text`, `image_path`, `image_url`, `file_path`, `jitter_min`, `jitter_max` |
| **`ig_fish_memory`** | **雙向讀寫 dsh-fish-memory 社交記憶庫**：支援讀取/寫入 DM 私訊對話、RM 貼文留言以及刷 Reel/貼文的感想內容，兼容 `messages` 與 `memories` 結構 | `action` (`read` \| `write`), `category` (`dm` \| `rm` \| `thought`), `target` (帳號或標籤), `content` (寫入文字), `media_pk`, `thought`, `role`, `tags`, `limit` |
| **`ig_get_timeline_feed`** | 抓取使用者首頁動態牆 (Timeline Feed) 貼文清單 | `limit` (number) |
| **`ig_get_user_medias`** | 指定帳號讀取最新發布之貼文與影片列表（唯讀） | `username` (string), `limit` (number) |
| **`ig_get_user_clips`** | 指定帳號專門讀取連續短片 (Reels / Clips) | `username` (string), `limit` (number) |
| **`ig_get_reels_feed`** | 瀏覽熱門或探索連續短片 (Reels) 動態 | `limit` (number) |
| **`ig_search_users`** | 搜尋 Instagram 使用者帳號 | `query` (string), `limit` (number) |
| **`ig_search_tags`** | 搜尋 Instagram 標籤名稱與貼文數 | `query` (string), `limit` (number) |
| **`ig_like_media`** | 對指定的 Instagram 貼文按讚 (受防風控保護) | `media_pk` (string) |
| **`ig_repost_media`** | **轉發貼文或連續短片 (Reel)**：支援限時動態 Story 卡片轉發（自動渲染 9:16 縮圖卡片、附上 `StoryMedia` 原貼文跳轉貼紙與 `StoryMention` 標註貼紙）、動態牆/Reels 貼文轉發 (`feed`) 與私訊卡片轉發 (`dm`)，可在轉發文案中 `@用戶` 並填寫對該 Reel/貼文的感想 | `media_pk` (PK/Shortcode/網址), `caption` (轉發文案含 `@用戶` 與感想), `repost_mode` (`story` \| `feed` \| `dm`), `mention_users` (string[]) |
| **`ig_get_anti_risk_status`** | 查詢 Instagram 防風控熔斷狀態、冷卻剩餘秒數與小時寫入計數 | 無 |
| **`ig_reset_anti_risk_cooldown`** | 手動解除防風控冷卻保護狀態 | 無 |

---

## 💻 3. 操作與調用方式

### 1. DSH AI 自然語言直接調用

- **模糊搜尋貼文**：「幫我用模糊搜尋找出 Instagram 上關於 deepseek 的最新貼文」-> `ig_fuzzy_search_posts(query="deepseek", limit=10)`
- **貼文/Reel 內文與留言**：「這篇貼文 PK 是 3123456789012345678，幫我看完整內文、視覺描述與留言」-> `ig_get_post_context(media_pk="3123456789012345678", comment_limit=15)`
- **發表留言**：「在貼文 3123456789012345678 下留言：『架構非常完整，感謝分享！』」-> `ig_post_comment(media_pk="3123456789012345678", text="架構非常完整，感謝分享！")`
- **檢查與發送私訊**：「查看我目前有沒有未讀的 Instagram 私訊」-> `ig_get_unread_dms(limit=10)`

### 2. 透過 HTTP REST API 調用 (DSH Web 路由，預設埠 3080)

```bash
# 取得當前 MCP 配置（含 username 與 masterUsername）
curl http://127.0.0.1:3080/api/instagram/mcp/config

# 更新 MCP 配置（統一設定機器人帳號與主人帳號）
curl -X POST http://127.0.0.1:3080/api/instagram/mcp/config \
  -H "Content-Type: application/json" \
  -d '{"username":"raxytw.ai","masterUsername":"raxytw.dev","autoStart":true}'

# 獲取 MCP 運行與登入狀態
curl http://127.0.0.1:3080/api/instagram/mcp/status

# 重啟 FastMCP 子進程
curl -X POST http://127.0.0.1:3080/api/instagram/mcp/restart

# 手動觸發登入 / 2FA 驗證
curl -X POST http://127.0.0.1:3080/api/instagram/mcp/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your_bot_user","password":"your_password"}'
```

### 3. TypeScript / Node.js 跨插件單例調用

```typescript
import {
  getSharedMcpClient,
  getSharedBotUsername,
  getSharedMasterUsername,
} from '@luoyi-dsh/instagram-mcp'

const mcpClient = getSharedMcpClient()
const botUser = getSharedBotUsername()
const masterUser = getSharedMasterUsername()

if (mcpClient && mcpClient.ready) {
  // 模糊搜尋關鍵字貼文
  const res = await mcpClient.igFuzzySearchPosts('tech', 10)

  // 抓取貼文或 Reel 完整上下文（含內文、視覺描述、配樂與子留言）
  const context = await mcpClient.igGetPostContext('3123456789012345678', 15)

  // 發送私訊
  await mcpClient.igSendDm({
    thread_id: '17841400000000000',
    text: '感謝您的來訊！',
  })
}
```

---

## ⚙️ 4. 設定參數說明 (`data/config.json`)

| 欄位名稱 | 型別 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| **`username`** | string | `""` | 機器人 Instagram 帳號（供登入與被 @ 識別，Plugin 與 Scroll 自動沿用） |
| **`masterUsername`** | string | `""` | 主人 Instagram 帳號（供發現好文時在留言區 @ 推坑，Plugin 與 Scroll 自動沿用） |
| **`password`** | string | `""` | Instagram 登入密碼（存在有效 Session 時可留空） |
| **`twoFactorCode`** | string | `""` | 2FA 雙步驟驗證碼 |
| **`sessionPath`** | string | `"data/ig_session.json"` | Session 快取檔案路徑 |
| **`proxyUrl`** | string | `""` | 代理伺服器 URL（例如 `http://127.0.0.1:7890`，選填） |
| **`pythonPath`** | string | `""` | 自訂 Python 可執行檔路徑（留空則自動探測系統 Python / uv） |
| **`autoStart`** | boolean | `true` | 啟動 DSH 時是否自動啟動 FastMCP 子進程並嘗試登入 |
