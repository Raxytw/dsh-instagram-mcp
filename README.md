# DSH Instagram FastMCP 核心服務插件 (`@luoyi-dsh/instagram-mcp`)

![Banner](assets/banner.png)

> **DeepSeek Harness (DSH)** 官方底層 Instagram 核心服務外掛。  
> 負責自動管理獨立的 Python FastMCP 子進程、維持登入 Session 憑證，並向 DSH Tools 與其他外掛提供標準 Model Context Protocol (MCP) 操作介面。

---

## 🌟 核心特性

1. **Python 虛擬環境自動維護**：
   - 自動檢測系統 Python / `uv` 環境。
   - 自動於插件目錄建立獨立 `.venv` 並安裝依賴清單 (`instagrapi`, `mcp<2`, `pydantic` 等)。
2. **FastMCP Stdio 子進程生命週期**：
   - 以 MCP 標準 Stdio 通訊協定管理 Python 伺服器子進程。
   - 支援優雅重啟、斷線重連與進程清理。
3. **Instagram Session 持久化與雙重驗證**：
   - 支援帳號密碼登入、Session 快取載入 (`data/ig_session.json`) 與 2FA 驗證碼挑戰。
4. **全域單例共享服務 (Zero-Error Singleton)**：
   - 導出 `getSharedMcpService()` 與 `getSharedMcpClient()`，供業務層插件 (`dsh-instagram-plugin`、`dsh-instagram-scroll`) 安全共享底層連線與登入狀態，完全免除 Cordis 的屬性存取拋錯。
5. **標準 MCP Tools 註冊**：
   - 向 DSH `ctx.tools` 註冊 9 項 Instagram 核心底層工具，供 AI 主模型直接調用。

---

## 📦 安裝方式

使用 DSH CLI 安裝外掛：

```bash
dsh plugin --profile web add @luoyi-dsh/instagram-mcp
```

或透過 npm 安裝：

```bash
npm install @luoyi-dsh/instagram-mcp
```

---

## 🛠️ 提供之 9 項標準 MCP 工具

| 工具名稱 | 說明 | 參數 |
| :--- | :--- | :--- |
| **`ig_check_status`** | 檢查 FastMCP 服務狀態與當前 Instagram 登入情形 | 無 |
| **`ig_login`** | 登入 Instagram 帳號或重新驗證 Session 快取 | `username`, `password`, `two_factor_code`, `proxy_url` |
| **`ig_search_hashtag`** | 搜尋指定 Hashtag 標籤之精選/最新貼文清單 | `hashtag` (string), `limit` (number) |
| **`ig_get_post_context`** | 抓取指定貼文之完整內文、發布者資訊與相鄰留言上下文 | `media_pk` (string), `comment_limit` (number) |
| **`ig_post_comment`** | 於指定貼文發表新留言，或對特定留言進行巢狀回覆 | `media_pk` (string), `text` (string), `reply_to_comment_pk` (可選) |
| **`ig_get_unread_dms`** | 讀取最新或未讀之 Instagram 私訊對話線程 | `limit` (number) |
| **`ig_send_dm`** | 發送 Instagram Direct Message 私訊給特定線程 | `thread_id` (string), `text` (string) |
| **`ig_get_timeline_feed`** | 抓取使用者首頁動態牆 (Timeline Feed) 貼文清單 | `limit` (number) |
| **`ig_like_media`** | 對指定的 Instagram 貼文按讚 | `media_pk` (string) |

---

## 💻 使用範例

### 1. DSH AI 自然語言直接調用

在 DSH 對話中，AI 模型會根據上下文自動調用合適的 MCP 工具：

- **搜尋標籤**：「幫我搜尋 Instagram 上關於 #deepseek 標籤的最新 5 則貼文」
- **貼文內文與留言**：「這篇貼文 PK 是 3123456789012345678，幫我看完整內文與留言」
- **發表留言**：「在貼文 3123456789012345678 下留言：『架構非常完整，感謝分享！』」
- **檢查私訊**：「查看我目前有沒有未讀的 Instagram 私訊」
- **發送私訊**：「發送私訊給線程 17841400000000000 說：『您好，已收到您的諮詢！』」

### 2. TypeScript / Node.js 跨插件調用

其他 DSH 外掛（如業務層擴充插件）可直接匯入單例客戶端：

```typescript
import { getSharedMcpClient } from '@luoyi-dsh/instagram-mcp'

const mcpClient = getSharedMcpClient()
if (mcpClient && mcpClient.ready) {
  // 搜尋指定標籤
  const posts = await mcpClient.igSearchHashtag('tech', 10)

  // 抓取貼文詳細內容
  const context = await mcpClient.igGetPostContext('3123456789012345678', 5)

  // 發送私訊
  await mcpClient.igSendDm({
    thread_id: '17841400000000000',
    text: '感謝您的來訊！',
  })
}
```

---

## ⚙️ 設定參數說明

可於 DSH 設定面板或插件目錄下的 `data/config.json` 中配置：

| 欄位名稱 | 型別 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| **`username`** | string | `""` | Instagram 使用者名稱 |
| **`password`** | string | `""` | Instagram 登入密碼（存在有效 Session 時可留空） |
| **`twoFactorCode`** | string | `""` | 2FA 雙步驟驗證碼 |
| **`sessionPath`** | string | `"data/ig_session.json"` | Session 快取檔案路徑 |
| **`proxyUrl`** | string | `""` | 代理伺服器 URL（例如 `http://127.0.0.1:7890`，選填） |
| **`pythonPath`** | string | `""` | 自訂 Python 可執行檔路徑（留空則自動探測系統 Python / uv） |
| **`autoStart`** | boolean | `true` | 啟動 DSH 時是否自動啟動 FastMCP 子進程並嘗試登入 |

---

## 📁 目錄結構

```text
dsh-instagram-mcp/
├── cordis.patch.yml               # DSH bundle patch 宣告
├── package.json                   # 模組定義與依賴宣告
├── tsconfig.json                  # TypeScript 編譯設定
├── assets/
│   └── banner.png                 # 宣傳圖示與橫幅
├── vendor/
│   └── instagram-mcp/             # 獨立 Python FastMCP 核心模組
│       ├── requirements.txt       # Python 依賴清單
│       ├── server.py              # FastMCP Stdio 伺服器入口
│       ├── auth.py                # 帳號認證、Session 復原與 2FA
│       └── core.py                # 貼文、留言、私訊、標籤等核心操作
└── src/
    ├── index.ts                   # 外掛入口與單例服務掛載
    ├── service.ts                 # InstagramMcpService 服務狀態管理器
    ├── config.ts                  # Schemastery 設定模型定義
    ├── types.ts                   # 型別與資料結構宣告
    ├── lib/
    │   ├── env.ts                 # Python 虛擬環境檢查與依賴安裝
    │   ├── mcp.ts                 # FastMCP Client 子進程通訊封裝
    │   └── hostdeps.ts            # DSH 宿主相容層
    └── tools/
        └── mcpTools.ts            # 向 DSH Tools 註冊之 9 項核心工具
```

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 開源授權。
