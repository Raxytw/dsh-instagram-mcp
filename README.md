# DSH Instagram FastMCP Core Service Plugin (`@luoyi-dsh/instagram-mcp`)

<div align="center">

![DSH Instagram MCP Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md) | [Agent & Operational Guide](AGENTS.md)**

</div>

> Official foundational Instagram FastMCP service plugin for **DeepSeek Harness (DSH)**.  
> Manages the Python FastMCP child process lifecycle, centralizes Bot (`username`) and Master (`masterUsername`) account bindings, maintains persistent Instagram session credentials and 2FA challenges, and provides standard Model Context Protocol (MCP) tools for DSH AI models and consumer plugins.

> [!CAUTION]
> ### ⚠️ CRITICAL WARNING & DISCLAIMER
> 1. **Violation of Instagram Terms of Service & Community Guidelines**:
>    This plugin and the underlying FastMCP server interact with Instagram via unofficial reverse-engineered APIs (via `instagrapi`), which **expressly violates Instagram / Meta's Terms of Use and Community Guidelines**.
> 2. **DO NOT USE YOUR PERSONAL / PRIMARY ACCOUNT**:
>    **Never use your personal, primary, or business-critical Instagram account!** Running automated tasks carries a severe risk of **Action Blocks, Challenge Checkpoints, temporary lockouts, and PERMANENT ACCOUNT SUSPENSION / BANNING**.
> 3. **Use Dedicated Burner / Alt Accounts & Clean Proxies**:
>    Only run this service using disposable test accounts paired with clean residential proxies.
> 4. **Disclaimer**:
>    This software is provided solely for educational and research purposes. The developers accept **no responsibility or liability** for any account bans or restrictions arising from the use of this project.

---

## 🌟 Key Features

1. **Centralized Account Binding**:
   - Configure the Bot Instagram account (`username`) and Master Instagram account (`masterUsername`) once in MCP; consumer plugins (`@luoyi-dsh/instagram-plugin` and `@luoyi-dsh/instagram-scroll`) inherit them automatically.
2. **Automated Python Environment & FastMCP Lifecycle**:
   - Auto-detects Python / `uv`, provisions an isolated `.venv`, and manages the stdio FastMCP subprocess with graceful reconnection.
3. **Multi-Stage Fuzzy Post & Reel Search (`ig_fuzzy_search_posts`)**:
   - Combines Instagram Top SERP (`fbsearch/top_serp`), Reels SERP, creator timelines, and hashtag sections to reliably retrieve posts even when hashtag tabs are restricted.
4. **Full Post & Reel Context Extraction (`ig_get_post_context` & `ig_get_recent_mentions`)**:
   - Extracts full captions, titles, accessibility visual descriptions, Reel audio metadata, video subtitles, image URLs, and nested comment replies (`preview_child_comments`).
5. **Multi-Layered Anti-Risk Protection**:
   - Humanized random jitter, read micro-pacing, hourly write caps, and automatic circuit breaker cooldowns upon detecting rate limits or Action Blocks.

---

## 📦 Installation

```bash
# Via DSH Plugin CLI
dsh plugin --profile web add @luoyi-dsh/instagram-mcp

# Or via npm
npm install @luoyi-dsh/instagram-mcp
```

---

## 📖 Operational Guide & Tool Reference

For complete MCP tool definitions, natural language prompts, HTTP REST API routes, cross-plugin SDK examples, and configuration parameters, please refer to **[AGENTS.md](AGENTS.md)**.

---

## 📁 Directory Structure

```text
dsh-instagram-mcp/
├── cordis.patch.yml               # DSH bundle patch manifest
├── package.json                   # Module definitions and dependencies
├── tsconfig.json                  # TypeScript compiler configuration
├── AGENTS.md                      # Operational & Agent Tool Guide
├── CHANGELOG.md                   # Version release notes
├── README.md                      # English overview (This file)
├── README.zh-Hant.md              # Traditional Chinese overview
├── client.js                      # DSH Web UI control panel
├── vendor/instagram-mcp/          # Standalone Python FastMCP server (server.py, auth.py, core.py)
└── src/                           # TypeScript service, MCP client wrapper, and tool registrations
```

---

## 📜 Releases & License

- See [CHANGELOG.md](CHANGELOG.md) for release history.
- Licensed under the [MIT License](LICENSE).
