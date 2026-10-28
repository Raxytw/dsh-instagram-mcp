# DSH Instagram FastMCP 核心服務插件 (`@luoyi-dsh/instagram-mcp`)

<div align="center">

![DSH Instagram MCP Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md) | [操作方法與 Agent 指南](AGENTS.md)**

</div>

> **DeepSeek Harness (DSH)** 官方底層 Instagram 核心服務外掛。  
> 負責自動管理獨立的 Python FastMCP 子進程、集中管理機器人帳號 (`username`) 與主人帳號 (`masterUsername`)、維持登入 Session 憑證，並向 DSH Tools 與上層外掛提供標準 Model Context Protocol (MCP) 操作介面。

> [!CAUTION]
> ### ⚠️ 重要風險警告與免責聲明 (CRITICAL DISCLAIMER)
> 1. **違反 Instagram 社群守則與服務條款**：本插件與底層 FastMCP 服務使用非官方逆向 API（基於 `instagrapi`），明確違反 Instagram / Meta 的服務條款與社群守則。
> 2. **切勿使用本人主要帳號運行**：嚴禁使用個人主要帳號或重要商業帳號！自動化讀寫操作極易觸發官方審查，導致功能限制 (Action Blocked)、安全驗證或永久封號。請務必使用測試小號並搭配純淨住宅代理。
> 3. **免責宣告**：本專案純屬技術研究用途，任何帳號停權或損失由使用者自負風險。

---

## 🌟 核心特性

1. **全域統一帳號綁定**：
   - 於本插件集中設定「機器人帳號 (`username`)」與「主人帳號 (`masterUsername`)」，上層插件 `@luoyi-dsh/instagram-plugin` 與 `@luoyi-dsh/instagram-scroll` 自動同步沿用，無須重複輸入。
2. **Python 虛擬環境與 FastMCP 子進程自動維護**：
   - 自動檢測系統 Python / `uv` 建立獨立 `.venv`，並管理 Stdio FastMCP 伺服器生命週期與 Session 持久化 (`data/ig_session.json`)。
3. **多階段模糊搜尋 (`ig_fuzzy_search_posts`)**：
   - 結合 Instagram 綜合搜尋 (`top_serp`)、Reels 搜尋與公開創作者最新貼文，徹底解決單純 Hashtag 標籤搜尋返回 0 則貼文的問題。
4. **完整貼文與 Reel 內容解析 (`ig_get_post_context` & `ig_get_recent_mentions`)**：
   - 完整提取貼文與 Reel 的內文、標題、無障礙視覺描述 (`accessibility_caption`)、配樂/原聲資訊 (`audio_info`)、影片字幕 (`video_subtitles`)、圖片 URL 以及巢狀樓中樓子留言 (`preview_child_comments`)。
5. **內建多重防風控安全機制 (Anti-Risk Control)**：
   - 寫入隨機抖動延遲 (Jitter)、讀取微延遲 (Pacing)、每小時寫入上限與異常自動熔斷冷卻保護 (Circuit Breaker)。

---

## 📦 安裝方式

```bash
# 使用 DSH CLI 安裝外掛
dsh plugin --profile web add @luoyi-dsh/instagram-mcp

# 或透過 npm 安裝
npm install @luoyi-dsh/instagram-mcp
```

---

## 📖 插件操作方法與工具調用說明

完整的 MCP 工具清單、自然語言調用範例、HTTP REST API 路由、跨插件 Node.js 調用方法與設定參數表，請參閱 **[AGENTS.md](AGENTS.md)**。

---

## 📁 目錄結構

```text
dsh-instagram-mcp/
├── cordis.patch.yml               # DSH bundle patch 宣告
├── package.json                   # 模組定義與依賴宣告
├── tsconfig.json                  # TypeScript 編譯設定
├── AGENTS.md                      # 插件操作方法與 Agent 調用指南
├── CHANGELOG.md                   # 版本更新紀錄
├── README.md                      # 英文介紹文件
├── README.zh-Hant.md              # 繁體中文介紹文件 (本檔案)
├── client.js                      # DSH Web 前端控制面板
├── vendor/instagram-mcp/          # 獨立 Python FastMCP 核心模組 (server.py, auth.py, core.py)
└── src/                           # 外掛入口、單例服務、MCP Client 與工具註冊
```

---

## 📜 版本紀錄與授權條款

- 詳細版本演進與更新紀錄，請參閱 [CHANGELOG.md](CHANGELOG.md)。
- 本專案採用 [MIT License](LICENSE) 開源授權。
