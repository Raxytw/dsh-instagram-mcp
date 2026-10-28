# DSH Instagram FastMCP 核心服務插件 (`@luoyi-dsh/instagram-mcp`)

<div align="center">

![DSH Instagram MCP Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md)**

</div>

> **DeepSeek Harness (DSH)** 官方底層 Instagram 核心服務外掛。  
> 負責自動管理獨立的 Python FastMCP 子進程、維持登入 Session 憑證，並向 DSH Tools 與其他外掛提供標準 Model Context Protocol (MCP) 操作介面。

> [!CAUTION]
> ### ⚠️ 重要風險警告與免責聲明 (CRITICAL DISCLAIMER)
> 1. **違反 Instagram 社群守則與服務條款**：
>    本插件與底層 FastMCP 服務使用非官方逆向 API（基於 `instagrapi`），**明確違反了 Instagram / Meta 的《服務條款 (Terms of Use)》及《社群守則 (Community Guidelines)》**。
> 2. **切勿使用本人主要帳號運行 (DO NOT USE YOUR PRIMARY ACCOUNT)**：
>    **嚴禁使用您個人的日常主要帳號、官方認證帳號或高價值商業帳號！** Instagram 官方具備嚴格的 AI 反爬與行為風控檢測，任何自動化讀寫操作均有極高機率觸發官方審查，導致：**功能限制 (Action Blocked)、強制手機簡訊/自拍驗證 (Challenge Checkpoint)、帳號臨時鎖定、甚至永久停權停號 (Permanent Ban)**！
> 3. **測試與備用小號原則**：
>    若需測試本外掛，請務必使用**無重要資料的測試用小號 (Burner / Alt Account)**，並強烈建議配置**優質純淨的住宅代理伺服器 (Residential Proxy)**，切勿在短時間內切換不同國家/地區的 IP。
> 4. **免責宣告**：
>    本專案純屬程式技術研究與開源通訊協定評估用途。使用者因安裝、運行或配置本外掛所導致之任何帳號停權、封禁、資料損失或相關責任，**開發者一概不負任何法律與連帶賠償責任**，使用時請務必審慎評估並自負風險！

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
5. **內建多重防風控安全機制 (Anti-Risk Control)**：
   - **擬真隨機抖動延遲 (Jitter)**：所有寫入行為預設執行 6~15 秒人造隨機等待；讀取與動態滾動注入 1.5~3.5 秒微延遲 (Pacing)。
   - **異常熔斷保護 (Circuit Breaker)**：當偵測到 Instagram 官方風控訊號（如 `FeedbackRequired` Action Blocked、`PleaseWaitFewMinutes`、`RateLimitError`）時，自動觸發 15~60 分鐘冷卻保護模式，即刻中斷後續所有寫入動作，保全帳號免遭永久封禁。
   - **小時頻次保護**：嚴格限制最近一小時內累計寫入操作上限（預設 15 次）。
   - **指紋與語系穩定**：固定設備語系 (`zh_TW`) 與請求間隔，減少環境跳躍風險。
6. **標準 MCP Tools 註冊**：
   - 向 DSH `ctx.tools` 註冊完整 Instagram 核心底層工具（含狀態、登入、搜尋、留言、私訊、動態牆、防風控熔斷管理），供 AI 主模型直接調用。
7. **專屬 Web REST API**：
   - 提供 `/api/instagram/mcp/*` 路由供前端控制面板讀寫配置、查詢運行狀態、重啟子進程及進行登入挑戰。

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

## 🛠️ 提供之標準 MCP 工具清單

| 工具名稱 | 說明 | 參數 |
| :--- | :--- | :--- |
| **`ig_check_status`** | 檢查 FastMCP 服務狀態、Session 登入情形與防風控熔斷冷卻倒數 | 無 |
| **`ig_login`** | 登入 Instagram 帳號或重新驗證 Session 快取 | `username`, `password`, `two_factor_code`, `proxy_url` |
| **`ig_search_hashtag`** | 搜尋指定 Hashtag 標籤之精選/最新貼文清單 | `hashtag` (string), `limit` (number) |
| **`ig_get_post_context`** | 抓取指定貼文之完整內文、發布者資訊與相鄰留言上下文 | `media_pk` (string), `comment_limit` (number) |
| **`ig_post_comment`** | 於指定貼文發表新留言，或對特定留言進行巢狀回覆 (受防風控保護) | `media_pk`, `text`, `reply_to_comment_pk`, `jitter_min`, `jitter_max` |
| **`ig_get_unread_dms`** | 讀取最新或未讀之 Instagram 私訊對話線程 (自帶微延遲) | `limit` (number) |
| **`ig_send_dm`** | 發送 Instagram Direct Message 私訊給特定線程 (受防風控保護) | `thread_id`, `text`, `jitter_min`, `jitter_max` |
| **`ig_get_timeline_feed`** | 抓取使用者首頁動態牆 (Timeline Feed) 貼文清單 | `limit` (number) |
| **`ig_like_media`** | 對指定的 Instagram 貼文按讚 (受防風控保護) | `media_pk` (string) |
| **`ig_get_anti_risk_status`** | 查詢 Instagram 防風控熔斷狀態、冷卻剩餘秒數與小時寫入計數 | 無 |
| **`ig_reset_anti_risk_cooldown`** | 手動解除防風控冷卻保護狀態 | 無 |

---

## 💻 使用範例

### 1. DSH AI 自然語言直接調用

在 DSH 對話中，AI 模型會根據上下文自動調用合適的 MCP 工具：

- **搜尋標籤**：「幫我搜尋 Instagram 上關於 #deepseek 標籤的最新 5 則貼文」
- **貼文內文與留言**：「這篇貼文 PK 是 3123456789012345678，幫我看完整內文與留言」
- **發表留言**：「在貼文 3123456789012345678 下留言：『架構非常完整，感謝分享！』」
- **檢查私訊**：「查看我目前有沒有未讀的 Instagram 私訊」
- **發送私訊**：「發送私訊給線程 17841400000000000 說：『您好，已收到您的諮詢！』」

### 2. 透過 HTTP REST API 調用 (DSH Web 路由)

> 💡 **提示**：DSH Web 預設埠號為 **3080**。

- **取得當前 MCP 配置**：
  ```bash
  curl http://127.0.0.1:3080/api/instagram/mcp/config
  ```

- **更新 MCP 配置**：
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/config \
    -H "Content-Type: application/json" \
    -d '{"autoStart":true}'
  ```

- **獲取 MCP 運行與登入狀態**：
  ```bash
  curl http://127.0.0.1:3080/api/instagram/mcp/status
  ```

- **重啟 FastMCP 子進程**：
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/restart
  ```

- **手動觸發登入 / 2FA 驗證**：
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/login \
    -H "Content-Type: application/json" \
    -d '{"username":"your_user","password":"your_password"}'
  ```

### 3. TypeScript / Node.js 跨插件調用

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
├── CHANGELOG.md                   # 版本更新紀錄
├── README.md                      # 英文說明文件
├── README.zh-Hant.md              # 繁體中文說明文件
├── assets/
│   ├── banner.png                 # 宣傳圖示與橫幅
│   └── zh-Hant.md                 # 本地化說明文件
├── client.js                      # DSH Web 前端面板
├── vendor/
│   └── instagram-mcp/             # 獨立 Python FastMCP 核心模組
│       ├── requirements.txt       # Python 依賴清單
│       ├── server.py              # FastMCP Stdio 伺服器入口
│       ├── auth.py                # 帳號認證、Session 復原與 2FA
│       └── core.py                # 貼文、留言、私訊、標籤等核心操作
└── src/
    ├── index.ts                   # 外掛入口、單例服務掛載與 REST API
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

## 📜 版本發布紀錄 (Releases)

詳細版本演進與更新紀錄，請參閱 [CHANGELOG.md](CHANGELOG.md)。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 開源授權。
