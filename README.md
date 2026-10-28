# DSH Instagram FastMCP Core Service Plugin (`@luoyi-dsh/instagram-mcp`)

<div align="center">

![DSH Instagram MCP Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md)**

</div>

> Official foundational Instagram FastMCP service plugin for **DeepSeek Harness (DSH)**.  
> Manages the Python FastMCP child process lifecycle, maintains persistent Instagram session credentials and 2FA challenges, and provides standard Model Context Protocol (MCP) tools for DSH AI models and consumer plugins.

> [!CAUTION]
> ### ⚠️ CRITICAL WARNING & DISCLAIMER
> 1. **Violation of Instagram Terms of Service & Community Guidelines**:
>    This plugin and the underlying FastMCP server interact with Instagram via unofficial reverse-engineered APIs (via `instagrapi`), which **expressly violates Instagram / Meta's Terms of Use and Community Guidelines**.
> 2. **DO NOT USE YOUR PERSONAL / PRIMARY ACCOUNT**:
>    **Never use your personal, primary, or business-critical Instagram account!** Instagram actively detects automated bot interactions using advanced risk algorithms. Running automated tasks carries a severe risk of **Action Blocks, Challenge Checkpoints, temporary lockouts, and PERMANENT ACCOUNT SUSPENSION / BANNING**.
> 3. **Use Dedicated Burner / Alt Accounts & Clean Proxies**:
>    Only run this service using disposable test accounts (burner/alt accounts) paired with dedicated, clean residential proxies. Avoid frequent IP or location hopping.
> 4. **Disclaimer**:
>    This software is provided solely for educational and research purposes. The developers and contributors accept **no responsibility or liability** for any account bans, suspensions, restrictions, or damages arising from the use of this project. Use entirely at your own risk.

---

## 🌟 Key Features

1. **Automated Python Environment Management**:
   - Auto-detects host Python or `uv` environments.
   - Automatically initializes an isolated `.venv` within the vendor directory and provisions all dependencies (`instagrapi`, `mcp<2`, `pydantic`, etc.).
2. **FastMCP Stdio Subprocess Lifecycle**:
   - Manages Python MCP server over standard stdio protocol.
   - Supports graceful restarts, reconnection handling, and automatic process teardown on shutdown.
3. **Session Persistence & 2FA Handling**:
   - Supports username/password authentication, persistent session cache reuse (`data/ig_session.json`), and interactive two-factor authentication (2FA) challenges.
4. **Zero-Error Shared Singleton Service**:
   - Exports `getSharedMcpService()` and `getSharedMcpClient()`, enabling consumer plugins (`dsh-instagram-plugin`, `dsh-instagram-scroll`) to safely access underlying connections and login state without Cordis property access errors.
5. **Built-in Multi-Layered Anti-Risk Protection**:
   - **Humanized Random Jitter**: Write operations enforce randomized delays (default 6–15 seconds); read queries and timeline browsing incorporate micro-pacing delays (1.5–3.5s).
   - **Circuit Breaker Cooldown**: Detects Instagram rate limit or block signals (`FeedbackRequired` Action Blocked, `PleaseWaitFewMinutes`, `RateLimitError`) and automatically initiates a 15–60 minute cooldown safeguard to prevent permanent account suspension.
   - **Hourly Write Cap**: Automatically throttles write operations if exceeding the hourly safety threshold (default 15 actions/hour).
   - **Device & Locale Fingerprint Stability**: Maintains consistent device headers and locale settings to prevent geo-hopping detection.
6. **Standard Model Context Protocol (MCP) Tools**:
   - Registers core Instagram tools with DSH `ctx.tools` (including login, search, comments, DMs, feed, and anti-risk management) for direct AI function calling.
7. **Dedicated Web REST API**:
   - Exposes `/api/instagram/mcp/*` endpoints to read/update configuration, query live daemon and login health, reboot the subprocess, reset cooldowns, and perform credential checks.

---

## 📦 Installation

Install via DSH Plugin CLI:

```bash
dsh plugin --profile web add @luoyi-dsh/instagram-mcp
```

Or via standard npm:

```bash
npm install @luoyi-dsh/instagram-mcp
```

---

## 🛠️ Provided MCP Tools

| Tool Name | Description | Parameters |
| :--- | :--- | :--- |
| **`ig_check_status`** | Check FastMCP service status, Instagram login state, and anti-risk cooldown status | None |
| **`ig_login`** | Authenticate Instagram account or validate existing session cache | `username`, `password`, `two_factor_code`, `proxy_url` |
| **`ig_search_hashtag`** | Search top and recent posts for a specified hashtag | `hashtag` (string), `limit` (number) |
| **`ig_get_post_context`** | Fetch complete post caption, author metadata, and adjacent comments | `media_pk` (string), `comment_limit` (number) |
| **`ig_post_comment`** | Publish a comment or reply to an existing comment on a post (Anti-risk protected) | `media_pk`, `text`, `reply_to_comment_pk`, `jitter_min`, `jitter_max` |
| **`ig_get_unread_dms`** | Read unread or latest Instagram direct message threads (with pacing delay) | `limit` (number) |
| **`ig_send_dm`** | Send a direct message to a specific thread (Anti-risk protected) | `thread_id`, `text`, `jitter_min`, `jitter_max` |
| **`ig_get_timeline_feed`** | Retrieve posts from user's timeline feed (with pacing delay) | `limit` (number) |
| **`ig_like_media`** | Like a specific Instagram post (Anti-risk protected) | `media_pk` (string) |
| **`ig_get_anti_risk_status`** | Query anti-risk circuit breaker status, remaining cooldown, and hourly write counts | None |
| **`ig_reset_anti_risk_cooldown`** | Manually reset anti-risk cooldown protection status | None |

---

## 💻 Usage Examples

### 1. Natural Language Invocation in DSH Chat

In DSH conversations, the host model automatically determines and calls appropriate MCP tools:

- **Search Hashtags**: "Search for the top 5 recent posts under #deepseek on Instagram."
- **Inspect Post Details**: "Look up post PK 3123456789012345678 and show me the full caption and comments."
- **Leave Comments**: "Comment on post 3123456789012345678: 'Great architecture overview, thanks for sharing!'"
- **Check DMs**: "Check if I have any unread direct messages on Instagram."
- **Send Direct Message**: "Send a DM to thread 17841400000000000 saying: 'Hello, inquiry received!'"

### 2. Via HTTP REST API (DSH Web Routes)

> 💡 **Tip**: Default DSH Web port is **3080**.

- **Read Configuration**:
  ```bash
  curl http://127.0.0.1:3080/api/instagram/mcp/config
  ```

- **Update Configuration**:
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/config \
    -H "Content-Type: application/json" \
    -d '{"autoStart":true}'
  ```

- **Get Service Health & Login Status**:
  ```bash
  curl http://127.0.0.1:3080/api/instagram/mcp/status
  ```

- **Restart FastMCP Subprocess**:
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/restart
  ```

- **Perform Login / 2FA Challenge**:
  ```bash
  curl -X POST http://127.0.0.1:3080/api/instagram/mcp/login \
    -H "Content-Type: application/json" \
    -d '{"username":"your_user","password":"your_password"}'
  ```

### 3. Cross-Plugin TypeScript / Node.js API

Consumer DSH plugins can directly import and call the shared client:

```typescript
import { getSharedMcpClient } from '@luoyi-dsh/instagram-mcp'

const mcpClient = getSharedMcpClient()
if (mcpClient && mcpClient.ready) {
  // Search hashtag
  const posts = await mcpClient.igSearchHashtag('tech', 10)

  // Fetch post details
  const context = await mcpClient.igGetPostContext('3123456789012345678', 5)

  // Send Direct Message
  await mcpClient.igSendDm({
    thread_id: '17841400000000000',
    text: 'Thanks for reaching out!',
  })
}
```

---

## ⚙️ Configuration Parameters

Configurable via the DSH Web UI or `data/config.json`:

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`username`** | string | `""` | Instagram username |
| **`password`** | string | `""` | Instagram password (can be left blank if valid session exists) |
| **`twoFactorCode`** | string | `""` | 2FA two-step verification code |
| **`sessionPath`** | string | `"data/ig_session.json"` | Path to the session cache file |
| **`proxyUrl`** | string | `""` | Outbound proxy URL (e.g. `http://127.0.0.1:7890`, optional) |
| **`pythonPath`** | string | `""` | Custom Python binary path (auto-detects Python / uv if blank) |
| **`autoStart`** | boolean | `true` | Automatically launch FastMCP subprocess and authenticate on startup |

---

## 📁 Directory Structure

```text
dsh-instagram-mcp/
├── cordis.patch.yml               # DSH bundle patch manifest
├── package.json                   # Module definitions and dependencies
├── tsconfig.json                  # TypeScript compiler configuration
├── CHANGELOG.md                   # Version release notes
├── README.md                      # English documentation (This file)
├── README.zh-Hant.md              # Traditional Chinese documentation
├── assets/
│   ├── banner.png                 # Promotional banner
│   └── zh-Hant.md                 # Localized documentation
├── client.js                      # DSH Web UI control panel
├── vendor/
│   └── instagram-mcp/             # Standalone Python FastMCP core
│       ├── requirements.txt       # Python dependencies
│       ├── server.py              # FastMCP Stdio server entrypoint
│       ├── auth.py                # Authentication, session restoration & 2FA
│       └── core.py                # Core operations (posts, comments, DMs, tags)
└── src/
    ├── index.ts                   # Plugin entrypoint, singleton service, and REST API
    ├── service.ts                 # InstagramMcpService runtime status manager
    ├── config.ts                  # Schemastery config schema
    ├── types.ts                   # TypeScript interfaces
    ├── lib/
    │   ├── env.ts                 # Python venv validation & package installer
    │   ├── mcp.ts                 # FastMCP client subprocess wrapper
    │   └── hostdeps.ts            # DSH runtime compatibility layer
    └── tools/
        └── mcpTools.ts            # 9 core MCP tools registration
```

---

## 📜 Releases & Changelog

For detailed release history and changes, please refer to [CHANGELOG.md](CHANGELOG.md).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
