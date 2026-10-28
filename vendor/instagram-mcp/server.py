#!/usr/bin/env python3
"""
Instagram FastMCP Server
為 DeepSeek Harness (DSH) 提供 Instagram 操作能力
採用 stdio 協議與 Node.js 宿主端通訊。日誌全部輸出至 stderr，防止污染 stdout JSON-RPC。
"""

import json
import logging
import os
import sys
from pathlib import Path

# 配置日誌輸出至 stderr，並強制 UTF-8 輸出
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [IG-MCP] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("instagram_mcp")

from instagrapi import Client
from mcp.server.fastmcp import FastMCP

from auth import InstagramAuth
from core import InstagramCore

# 初始化 Instagram 客戶端與封裝實例
cl = Client()
auth_handler = InstagramAuth(cl)
core_handler = InstagramCore(cl)

# 實例化 FastMCP 伺服器
mcp = FastMCP("instagram-mcp")


from typing import Any

def _safe_str(val: Any, default: str = "") -> str:
    if isinstance(val, str):
        return val
    if val is None or isinstance(val, (dict, list)):
        return default
    return str(val)


@mcp.tool()
def ig_login(
    username: Any = "",
    password: Any = "",
    session_path: Any = "data/ig_session.json",
    two_factor_code: Any = "",
    proxy_url: Any = "",
) -> str:
    """登入 Instagram 帳號或載入現有 Session 憑證。

    Args:
        username: Instagram 使用者帳號
        password: Instagram 登入密碼（若有有效 Session 可留空）
        session_path: Session 檔案路徑（預設 data/ig_session.json）
        two_factor_code: 2FA 雙重驗證代碼（需要時填入）
        proxy_url: HTTP / SOCKS5 代理伺服器 URL
    """
    clean_username = _safe_str(username, "")
    clean_password = _safe_str(password, "")
    clean_session_path = _safe_str(session_path, "data/ig_session.json") or "data/ig_session.json"
    clean_2fa = _safe_str(two_factor_code, "")
    clean_proxy = _safe_str(proxy_url, "")

    res = auth_handler.login(
        username=clean_username,
        password=clean_password,
        session_path=clean_session_path,
        two_factor_code=clean_2fa,
        proxy_url=clean_proxy,
    )
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_search_hashtag(hashtag: str, limit: int = 10) -> str:
    """搜尋指定標籤（Hashtag）之最新貼文列表。

    Args:
        hashtag: 標籤名稱（例如 tech, deepseek, ai，可不帶#）
        limit: 抓取貼文筆數上限
    """
    res = core_handler.search_hashtag_posts(hashtag=hashtag, limit=limit)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_user_medias(username: str, limit: int = 10) -> str:
    """指定帳號讀取最新發布之貼文與影片列表 (純瀏覽、安全只讀不發文)。

    Args:
        username: Instagram 使用者帳號名稱（例如 wired, techcrunch, verge 等，可不帶@）
        limit: 抓取貼文筆數上限 (預設 10)
    """
    res = core_handler.get_user_medias(username=username, limit=limit)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_user_clips(username: str, limit: int = 10) -> str:
    """指定帳號專門讀取連續短片 (Reels / Clips)。

    Args:
        username: Instagram 使用者帳號名稱（可不帶@）
        limit: 抓取 Reels 筆數上限 (預設 10)
    """
    res = core_handler.get_user_clips(username=username, limit=limit)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_reels_feed(limit: int = 10) -> str:
    """獲取熱門或探索連續短片 (Reels) 動態，供刷短片/影片純瀏覽使用。

    Args:
        limit: 抓取 Reels 數量上限 (預設 10)
    """
    res = core_handler.get_reels_feed(limit=limit)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_search_users(query: str, limit: int = 10) -> str:
    """搜尋 Instagram 使用者帳號，檢索官方帳號、ID 與頭像。

    Args:
        query: 搜尋關鍵字或帳號部分字串
        limit: 搜尋結果筆數上限 (預設 10)
    """
    users = core_handler.search_users(query=query, limit=limit)
    return json.dumps({"ok": True, "query": query, "users": users}, ensure_ascii=False)


@mcp.tool()
def ig_search_tags(query: str, limit: int = 10) -> str:
    """搜尋 Instagram 標籤（Hashtag）名稱與貼文數。

    Args:
        query: 搜尋關鍵字 (例如 ai, tech)
        limit: 搜尋結果筆數上限 (預設 10)
    """
    tags = core_handler.search_tags(query=query, limit=limit)
    return json.dumps({"ok": True, "query": query, "tags": tags}, ensure_ascii=False)


@mcp.tool()
def ig_get_post_context(media_pk: str, comment_limit: int = 10) -> str:
    """取得指定貼文之完整內文與留言上下文脈絡。

    Args:
        media_pk: 貼文唯一識別碼 (Media PK)
        comment_limit: 抓取相鄰留言之最大筆數
    """
    ctx = core_handler.get_post_context(media_pk=media_pk, comment_limit=comment_limit)
    return json.dumps(ctx, ensure_ascii=False)


@mcp.tool()
def ig_post_comment(
    media_pk: str,
    text: str,
    reply_to_comment_pk: str = "",
    jitter_min: float = 3.0,
    jitter_max: float = 6.0,
) -> str:
    """在貼文下發布留言或針對特定留言進行巢狀子留言回覆。

    Args:
        media_pk: 貼文唯一識別碼
        text: 留言文字內容
        reply_to_comment_pk: 要回覆之留言 PK（若為新留言則留空）
        jitter_min: 最小隨機等待秒數
        jitter_max: 最大隨機等待秒數
    """
    res = core_handler.post_comment(
        media_pk=media_pk,
        text=text,
        reply_to_comment_pk=reply_to_comment_pk or None,
        jitter_min=jitter_min,
        jitter_max=jitter_max,
    )
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_unread_dms(limit: int = 10) -> str:
    """讀取未讀或最新的私訊對話線程。

    Args:
        limit: 抓取對話線程數量上限
    """
    threads = core_handler.get_unread_dms(limit=limit)
    return json.dumps({"ok": True, "threads": threads}, ensure_ascii=False)


@mcp.tool()
def ig_send_dm(
    thread_id: str,
    text: str,
    jitter_min: float = 3.0,
    jitter_max: float = 6.0,
) -> str:
    """發送私訊到指定對話線程。

    Args:
        thread_id: 私訊對話線程 ID
        text: 回覆訊息內容
        jitter_min: 最小隨機等待秒數
        jitter_max: 最大隨機等待秒數
    """
    res = core_handler.send_dm(
        thread_id=thread_id,
        text=text,
        jitter_min=jitter_min,
        jitter_max=jitter_max,
    )
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_timeline_feed(limit: int = 10) -> str:
    """獲取 Instagram 動態牆 (Timeline Feed) 或探索頁貼文，供滾動瀏覽使用。

    Args:
        limit: 抓取貼文數量上限
    """
    posts = core_handler.get_timeline_feed(limit=limit)
    return json.dumps({"ok": True, "posts": posts}, ensure_ascii=False)


@mcp.tool()
def ig_like_media(media_pk: str) -> str:
    """對指定貼文點讚。

    Args:
        media_pk: 貼文唯一識別碼
    """
    res = core_handler.like_media(media_pk=media_pk)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def ig_get_anti_risk_status() -> str:
    """獲取 Instagram 防風控安全狀態（熔斷冷卻倒數、最近一小時寫入次數等）。"""
    status = core_handler.get_anti_risk_status()
    return json.dumps({"ok": True, "anti_risk": status}, ensure_ascii=False)


@mcp.tool()
def ig_reset_anti_risk_cooldown() -> str:
    """手動解除防風控熔斷冷卻保護狀態（僅在確認帳號已恢復正常時使用）。"""
    res = core_handler.reset_anti_risk_cooldown()
    return json.dumps(res, ensure_ascii=False)


if __name__ == "__main__":
    logger.info("Starting Instagram FastMCP Server on stdio...")
    mcp.run(transport="stdio")


