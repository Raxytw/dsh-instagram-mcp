# Changelog

All notable changes to `@luoyi-dsh/instagram-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.2] - 2026-10-28

### Added
- **Complete FastMCP WebServer REST API**:
  - Registered `/api/instagram/mcp/config` (GET / POST) to read and save configuration dynamically without restarting the host.
  - Registered `/api/instagram/mcp/status` (GET) providing comprehensive runtime status, session validity, and subprocess health.
  - Registered `/api/instagram/mcp/restart` (POST) to cleanly terminate and reboot the Python FastMCP stdio subprocess.
  - Registered `/api/instagram/mcp/login` (POST) supporting dynamic credential checks and 2FA challenge responses.
- **Enhanced Login & Session State Management**:
  - Extended `InstagramMcpService.loginStatus` to preserve `username`, `user_id`, and resolved physical `sessionPath` for consumer plugins (`dsh-instagram-plugin`, `dsh-instagram-scroll`).
- **Tool Output Rendering**:
  - Registered JSON/text render output formatting for all 9 MCP tools to present cleanly in DSH chat streams.
- **Multi-language Documentation**:
  - Added bilingual README (English & Traditional Chinese) and release documentation.

### Changed
- Standardized Cordis patch identifier to `@luoyi-dsh/instagram-mcp`.
- Refined `client.js` with `immediately: true` for instantaneous tab loading and improved restart button feedback.

---

## [1.0.1] - 2026-10-27

### Fixed
- Improved Python environment bootstrapping with `uv` and virtual environment detection.
- Fixed cross-plugin singleton export to prevent Cordis property access errors.

---

## [1.0.0] - 2026-10-27

### Initial Release
- **FastMCP Stdio Core**: Python FastMCP subprocess manager supporting `instagrapi` operations.
- **Session Cache & 2FA**: Automatic session persistence and challenge handling.
- **9 Core MCP Tools**: Standard Model Context Protocol tools for login, status, search, comments, feeds, and DMs.
- **Zero-Error Singleton Service**: Exported `getSharedMcpService()` and `getSharedMcpClient()`.
