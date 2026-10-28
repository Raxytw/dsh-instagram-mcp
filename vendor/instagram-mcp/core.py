import logging
import random
import time
from typing import List, Dict, Any, Optional
from instagrapi import Client
from instagrapi.exceptions import (
    FeedbackRequired,
    PleaseWaitFewMinutes,
    RateLimitError,
    SentryBlock,
    ChallengeRequired,
    LoginRequired,
)

logger = logging.getLogger("instagram_mcp.core")


class AntiRiskManager:
    """
    Instagram 防風控安全管理員 (Anti-Risk Control Circuit Breaker)
    ============================================================================
    核心防護能力：
    1. 異常熔斷冷卻 (Circuit Breaker)：
       當偵測到 Instagram 官方風控訊號（如 FeedbackRequired 即 Action Blocked、
       PleaseWaitFewMinutes、RateLimitError、SentryBlock）時，自動觸發 15~60 分鐘冷卻保護模式，
       立刻中斷並阻絕後續所有寫入操作（留言、發訊、點讚），防止帳號被永久封禁。
    2. 小時頻次防護 (Hourly Write Cap)：
       嚴格限制單一小時內累計的寫入動作次數（預設上限 15 次），避免頻繁高頻行為被官方演算法標記為機器人。
    3. 動作間隔節奏控制 (Pacing & Spacing)：
       維持相鄰寫入動作間人造隨機延遲，並在讀取與滾動時注入擬真微延遲。
    ============================================================================
    """

    def __init__(self, hourly_write_cap: int = 15, cooldown_minutes: int = 30):
        self.hourly_write_cap = hourly_write_cap
        self.default_cooldown_minutes = cooldown_minutes
        self.cooldown_until: float = 0.0
        self.cooldown_reason: str = ""
        self.action_history: List[Dict[str, Any]] = []
        self.last_write_timestamp: float = 0.0

    def is_in_cooldown(self) -> bool:
        return time.time() < self.cooldown_until

    def get_cooldown_remaining(self) -> int:
        return max(0, int(self.cooldown_until - time.time()))

    def trigger_cooldown(self, minutes: Optional[int] = None, reason: str = ""):
        dur = minutes if minutes is not None else self.default_cooldown_minutes
        self.cooldown_until = time.time() + (dur * 60)
        self.cooldown_reason = reason
        expire_str = time.strftime("%H:%M:%S", time.localtime(self.cooldown_until))
        logger.error(
            f"🚨 [防風控熔斷生效] 帳號進入冷卻保護模式 {dur} 分鐘（預計至 {expire_str} 解除）！\n"
            f"   原因: {reason}\n"
            f"   ⚠️ 在此冷卻期間，系統將自動攔截所有留言、點讚、私訊等寫入行為，以保全帳號免遭 Instagram 永久停權！"
        )

    def reset_cooldown(self):
        self.cooldown_until = 0.0
        self.cooldown_reason = ""
        logger.info("🛡️ [防風控] 手動清除冷卻保護狀態。")

    def _clean_history(self):
        cutoff = time.time() - 3600
        self.action_history = [item for item in self.action_history if item.get("time", 0) >= cutoff]

    def get_hourly_action_count(self, action_type: Optional[str] = None) -> int:
        self._clean_history()
        if action_type:
            return sum(1 for item in self.action_history if item.get("type") == action_type)
        return len(self.action_history)

    def check_write_permission(self, action_type: str = "write") -> Dict[str, Any]:
        """檢查是否允許執行寫入行為"""
        if self.is_in_cooldown():
            rem = self.get_cooldown_remaining()
            return {
                "allowed": False,
                "in_cooldown": True,
                "remaining_seconds": rem,
                "reason": (
                    f"帳號目前處於防風控冷卻保護中（剩餘 {rem} 秒）。"
                    f"觸發原因：{self.cooldown_reason or 'Instagram 官方頻率限制或功能阻擋'}。"
                    f"為防止帳號被永久封禁，已自動攔截寫入操作。"
                ),
            }

        self._clean_history()
        if len(self.action_history) >= self.hourly_write_cap:
            return {
                "allowed": False,
                "in_cooldown": False,
                "remaining_seconds": 0,
                "reason": (
                    f"已達到防風控小時寫入上限（最近 1 小時內已執行 {len(self.action_history)} 次，上限 {self.hourly_write_cap} 次）。"
                    f"已自動延緩後續寫入動作，保護帳號安全。"
                ),
            }

        return {"allowed": True, "in_cooldown": False}

    def record_action(self, action_type: str, details: str = ""):
        self._clean_history()
        now = time.time()
        self.last_write_timestamp = now
        self.action_history.append({
            "type": action_type,
            "time": now,
            "details": details,
        })

    def get_status(self) -> Dict[str, Any]:
        self._clean_history()
        return {
            "in_cooldown": self.is_in_cooldown(),
            "cooldown_remaining_sec": self.get_cooldown_remaining(),
            "cooldown_reason": self.cooldown_reason,
            "hourly_write_count": len(self.action_history),
            "hourly_write_cap": self.hourly_write_cap,
            "last_write_timestamp": self.last_write_timestamp,
        }


class InstagramCore:
    """Instagram 核心業務邏輯封裝 (搜尋、純瀏覽、Reel、貼文詳情、留言、私訊與多重防風控保護)"""

    def __init__(self, client: Client, anti_risk: Optional[AntiRiskManager] = None):
        self.cl = client
        self.anti_risk = anti_risk or AntiRiskManager()
        try:
            self.cl.delay_range = [3, 6]
        except Exception:
            pass

    def _apply_jitter(self, min_sec: float = 6.0, max_sec: float = 15.0):
        """執行擬真隨機抖動延遲，降低頻繁呼叫產生的風控風險"""
        delay = random.uniform(max(0.5, min_sec), max(min_sec, max_sec))
        logger.debug(f"Applying jitter delay: {delay:.2f} seconds...")
        time.sleep(delay)

    def _apply_read_pacing(self, min_sec: float = 1.5, max_sec: float = 3.5):
        """唯讀操作微延遲，避免短時間並發突增呼叫"""
        delay = random.uniform(min_sec, max_sec)
        time.sleep(delay)

    def _parse_media_item(self, m: Any) -> Optional[Dict[str, Any]]:
        """統一解析 instagrapi Media 物件或原始字典，支援單圖、輪播、影片與 Reel 短片（含視覺描述、音訊資訊與多圖 URL）"""
        if not m:
            return None
        try:
            title = ""
            accessibility_caption = ""
            audio_info = ""
            image_urls: List[str] = []
            video_duration = 0.0
            location_name = ""

            if isinstance(m, dict):
                pk = str(m.get("pk") or m.get("id") or "").split("_")[0]
                id_ = str(m.get("id") or "")
                code = str(m.get("code") or "")
                caption = str(m.get("caption", {}).get("text", "") if isinstance(m.get("caption"), dict) else (m.get("caption_text") or ""))
                title = str(m.get("title") or "")
                accessibility_caption = str(m.get("accessibility_caption") or "")
                like_count = int(m.get("like_count") or 0)
                comment_count = int(m.get("comment_count") or 0)
                view_count = int(m.get("view_count") or m.get("play_count") or 0)
                media_type = int(m.get("media_type") or 1)
                product_type = str(m.get("product_type") or "feed")
                video_duration = float(m.get("video_duration") or 0.0)

                video_url = str(m.get("video_url") or "")
                if not video_url and isinstance(m.get("video_versions"), list) and m["video_versions"]:
                    video_url = str(m["video_versions"][0].get("url") or "")

                thumbnail_url = str(m.get("thumbnail_url") or "")
                if not thumbnail_url and isinstance(m.get("image_versions2"), dict):
                    cands = m["image_versions2"].get("candidates") or []
                    if isinstance(cands, list) and cands:
                        thumbnail_url = str(cands[0].get("url") or "")
                if thumbnail_url:
                    image_urls.append(thumbnail_url)

                # 若為輪播圖文 (carousel_media)，提取每張圖的 URL 與無障礙視覺描述
                carousel_a11y = []
                for idx, cm in enumerate(m.get("carousel_media") or []):
                    if isinstance(cm, dict):
                        cm_a11y = str(cm.get("accessibility_caption") or "").strip()
                        if cm_a11y:
                            carousel_a11y.append(f"[圖{idx+1}] {cm_a11y}")
                        cm_cands = (cm.get("image_versions2") or {}).get("candidates") or []
                        if isinstance(cm_cands, list) and cm_cands:
                            u_url = str(cm_cands[0].get("url") or "")
                            if u_url and u_url not in image_urls:
                                image_urls.append(u_url)
                if carousel_a11y and not accessibility_caption:
                    accessibility_caption = " | ".join(carousel_a11y)

                # 提取 Reel / 影片音訊與音樂資訊 (clips_metadata)
                clips_meta = m.get("clips_metadata") or {}
                if isinstance(clips_meta, dict):
                    music_info = clips_meta.get("music_info") or {}
                    music_asset = music_info.get("music_asset_info") if isinstance(music_info, dict) else {}
                    orig_sound = clips_meta.get("original_sound_info") or {}
                    if isinstance(music_asset, dict) and (music_asset.get("title") or music_asset.get("display_artist")):
                        audio_info = f"配樂：{music_asset.get('title', '')} - {music_asset.get('display_artist', '')}".strip(" -")
                    elif isinstance(orig_sound, dict) and orig_sound.get("original_audio_title"):
                        ig_artist = (orig_sound.get("ig_artist") or {}).get("username", "")
                        audio_info = f"原聲：{orig_sound.get('original_audio_title', '')}" + (f" (@{ig_artist})" if ig_artist else "")

                loc = m.get("location") or {}
                if isinstance(loc, dict) and loc.get("name"):
                    location_name = str(loc.get("name") or "")

                taken_at = str(m.get("taken_at") or "")
                u = m.get("user") or {}
                user_info = {
                    "pk": str(u.get("pk") or ""),
                    "username": str(u.get("username") or ""),
                    "full_name": str(u.get("full_name") or ""),
                    "is_verified": bool(u.get("is_verified") or False),
                }
                coauthors = []
                for c in m.get("coauthor_producers", []):
                    cname = c.get("username") if isinstance(c, dict) else str(getattr(c, "username", ""))
                    if cname:
                        coauthors.append(cname)
            else:
                pk = str(getattr(m, "pk", "")).split("_")[0]
                id_ = str(getattr(m, "id", ""))
                code = str(getattr(m, "code", ""))
                caption = str(getattr(m, "caption_text", "") or "")
                title = str(getattr(m, "title", "") or "")
                accessibility_caption = str(getattr(m, "accessibility_caption", "") or "")
                like_count = int(getattr(m, "like_count", 0) or 0)
                comment_count = int(getattr(m, "comment_count", 0) or 0)
                view_count = int(getattr(m, "view_count", 0) or getattr(m, "play_count", 0) or 0)
                media_type = int(getattr(m, "media_type", 1) or 1)
                product_type = str(getattr(m, "product_type", "feed") or "feed")
                video_duration = float(getattr(m, "video_duration", 0.0) or 0.0)
                video_url = str(getattr(m, "video_url", "") or "")
                thumbnail_url = str(getattr(m, "thumbnail_url", "") or "")
                if thumbnail_url:
                    image_urls.append(thumbnail_url)
                for res_item in getattr(m, "resources", []) or []:
                    r_thumb = str(getattr(res_item, "thumbnail_url", "") or "")
                    if r_thumb and r_thumb not in image_urls:
                        image_urls.append(r_thumb)
                taken_at = m.taken_at.isoformat() if hasattr(m, "taken_at") and m.taken_at else ""

                u = getattr(m, "user", None)
                user_info = {
                    "pk": str(getattr(u, "pk", "")),
                    "username": str(getattr(u, "username", "")),
                    "full_name": str(getattr(u, "full_name", "")),
                    "is_verified": bool(getattr(u, "is_verified", False)),
                } if u else {}

                coauthors = []
                for c in getattr(m, "coauthor_producers", []):
                    cname = getattr(c, "username", "")
                    if cname:
                        coauthors.append(cname)

            is_video = media_type == 2 or bool(video_url) or product_type in ("clips", "igtv")
            is_reel = product_type == "clips" or (media_type == 2 and product_type != "igtv")
            is_carousel = media_type == 8 or product_type == "carousel_container"

            type_label = "Reel 連續短片" if is_reel else "影片" if is_video else "輪播圖文" if is_carousel else "單張圖片"

            return {
                "pk": pk,
                "id": id_,
                "code": code,
                "title": title,
                "caption": caption,
                "accessibility_caption": accessibility_caption,
                "audio_info": audio_info,
                "location_name": location_name,
                "video_duration": video_duration,
                "like_count": like_count,
                "comment_count": comment_count,
                "view_count": view_count,
                "media_type": media_type,
                "product_type": product_type,
                "type_label": type_label,
                "is_video": is_video,
                "is_reel": is_reel,
                "is_carousel": is_carousel,
                "thumbnail_url": thumbnail_url,
                "image_urls": image_urls[:4],
                "video_url": video_url,
                "user": user_info,
                "is_collaborative": len(coauthors) > 0,
                "coauthors": coauthors,
                "url": f"https://www.instagram.com/reel/{code}/" if (code and is_reel) else (f"https://www.instagram.com/p/{code}/" if code else ""),
                "taken_at": taken_at,
            }
        except Exception as err:
            logger.warning(f"Error parsing media item: {err}")
            return None

    def _extract_medias_from_raw(self, raw_data: Any, limit: int = 30) -> List[Dict[str, Any]]:
        """遞迴從 Instagram 原始 API 回應 (如 fbsearch/top_serp, reels_serp, sections 等) 提取所有貼文與短片節點"""
        extracted: List[Dict[str, Any]] = []
        seen_keys = set()

        def _walk(node: Any, depth: int = 0):
            if depth > 14 or len(extracted) >= limit or node is None:
                return
            if isinstance(node, dict):
                has_id = bool(node.get("pk") or node.get("id"))
                has_code = bool(node.get("code"))
                has_media_indicator = any(
                    k in node for k in ("media_type", "product_type", "caption", "caption_text", "image_versions2", "video_versions")
                )
                if has_id and has_code and has_media_indicator:
                    parsed = self._parse_media_item(node)
                    if parsed:
                        key = parsed.get("pk") or parsed.get("code")
                        if key and key not in seen_keys:
                            seen_keys.add(key)
                            extracted.append(parsed)
                            return

                for k, v in node.items():
                    if k in ("comments", "preview_comments", "likers", "facepile_top_likers"):
                        continue
                    _walk(v, depth + 1)
            elif isinstance(node, list):
                for item in node:
                    if len(extracted) >= limit:
                        break
                    _walk(item, depth + 1)

        _walk(raw_data, 0)
        return extracted

    def fuzzy_search_posts(self, query: str, limit: int = 10) -> Dict[str, Any]:
        """模糊搜尋貼文與短片 (Fuzzy Search)：
        結合 Instagram 綜合搜尋 (top_serp)、Reels 關鍵字搜尋 (reels_serp) 與相關公開創作者最新貼文，
        解決單純使用 Hashtag (tags/sections) 經常抓取到 0 則貼文的問題。
        """
        q = query.lstrip("#@").strip()
        if not q:
            return {"ok": False, "error": "搜尋關鍵字不可為空", "query": "", "posts": []}

        logger.info(f"Fuzzy searching posts for keyword '{q}' with limit {limit}...")
        self._apply_read_pacing(1.2, 2.5)

        results: List[Dict[str, Any]] = []
        seen_pks = set()
        sources_used: List[str] = []
        matched_usernames: List[str] = []

        def _add_parsed_item(item: Optional[Dict[str, Any]], source_tag: str):
            if not item:
                return
            pk = str(item.get("pk") or item.get("code") or "")
            if not pk or pk in seen_pks:
                return
            seen_pks.add(pk)
            results.append(item)
            if source_tag not in sources_used:
                sources_used.append(source_tag)

        # 1. 第一階段：Instagram Top SERP 綜合模糊搜尋 (fbsearch/top_serp/)
        try:
            if hasattr(self.cl, "fbsearch_topsearch_v2"):
                raw_top = self.cl.fbsearch_topsearch_v2(q)
                if isinstance(raw_top, dict):
                    for m in self._extract_medias_from_raw(raw_top, limit=limit * 2):
                        _add_parsed_item(m, "top_serp")
                        if len(results) >= limit:
                            break
                    # 順便收集 SERP 中推薦的公開帳號作為後續備援
                    for u in raw_top.get("users", []) or []:
                        ud = u.get("user") if isinstance(u, dict) and "user" in u else u
                        if isinstance(ud, dict) and not ud.get("is_private") and ud.get("username"):
                            matched_usernames.append(str(ud.get("username")))
        except Exception as e1:
            logger.debug(f"fbsearch_topsearch_v2 notice for '{q}': {e1}")

        # 若 instagrapi media_search 可補充
        if len(results) < limit and hasattr(self.cl, "media_search"):
            try:
                ms_items = self.cl.media_search(q, amount=limit)
                for m in ms_items or []:
                    _add_parsed_item(self._parse_media_item(m), "media_search")
                    if len(results) >= limit:
                        break
            except Exception as ems:
                logger.debug(f"media_search notice for '{q}': {ems}")

        # 2. 第二階段：Instagram Reels 關鍵字模糊搜尋 (fbsearch/reels_serp/)
        if len(results) < limit and hasattr(self.cl, "fbsearch_reels_v2"):
            try:
                self._apply_read_pacing(1.0, 2.0)
                raw_reels = self.cl.fbsearch_reels_v2(q)
                if isinstance(raw_reels, dict):
                    for m in self._extract_medias_from_raw(raw_reels, limit=limit * 2):
                        _add_parsed_item(m, "reels_serp")
                        if len(results) >= limit:
                            break
            except Exception as e2:
                logger.debug(f"fbsearch_reels_v2 notice for '{q}': {e2}")

        # 3. 第三階段：關鍵字模糊匹配相關創作者帳號並抓取其最新貼文/短片 (Users Search -> User Medias/Clips)
        if len(results) < limit:
            try:
                if not matched_usernames:
                    users = self.cl.search_users(q)
                    for u in (users or [])[:5]:
                        if not getattr(u, "is_private", False) and getattr(u, "username", ""):
                            matched_usernames.append(str(getattr(u, "username")))

                for uname in matched_usernames[:2]:
                    if len(results) >= limit:
                        break
                    self._apply_read_pacing(1.0, 2.0)
                    need = max(2, min(5, limit - len(results)))
                    user_res = self.get_user_medias(uname, limit=need)
                    for p in user_res.get("posts", []) or []:
                        _add_parsed_item(p, f"user:{uname}")
                        if len(results) >= limit:
                            break
            except Exception as e3:
                logger.debug(f"fuzzy user medias fallback notice for '{q}': {e3}")

        logger.info(f"Fuzzy search for '{q}' retrieved {len(results)} posts (sources={sources_used})")
        return {
            "ok": True,
            "query": q,
            "count": len(results),
            "posts": results[:limit],
            "sources": sources_used,
            "status": "success" if len(results) > 0 else "empty",
        }

    def search_hashtag_posts(self, hashtag: str, limit: int = 10) -> Dict[str, Any]:
        """搜尋指定 Hashtag 的最新貼文，包含防空判定與詳細診斷"""
        tag = hashtag.lstrip("#").strip()
        if not tag:
            return {"ok": False, "error": "標籤名稱不可為空", "posts": []}

        logger.info(f"Searching hashtag #{tag} with limit {limit}...")
        self._apply_read_pacing(1.5, 3.0)
        medias = []
        api_error = None
        try:
            medias = self.cl.hashtag_medias_recent(tag, amount=limit)
        except Exception as e:
            logger.warning(f"hashtag_medias_recent failed for #{tag}: {e}")
            api_error = str(e)

        # 若 recent 回傳 0 則 (Instagram 經常對 recent tab 回傳空列表而不拋錯)，自動嘗試 top 與 reels_v1
        if not medias:
            try:
                medias = self.cl.hashtag_medias_top(tag, amount=limit)
            except Exception as e2:
                logger.debug(f"hashtag_medias_top failed for #{tag}: {e2}")
                api_error = str(e2)

        if not medias and hasattr(self.cl, "hashtag_medias_reels_v1"):
            try:
                medias = self.cl.hashtag_medias_reels_v1(tag, amount=limit)
            except Exception as e3:
                logger.debug(f"hashtag_medias_reels_v1 failed for #{tag}: {e3}")

        results = []
        for m in medias:
            parsed = self._parse_media_item(m)
            if parsed:
                results.append(parsed)

        logger.info(f"Retrieved {len(results)} posts for #{tag}")
        notice = None
        if len(results) == 0:
            notice = f"標籤 #{tag} 取得 0 則貼文。可能因 Instagram 官方限制公開 Hashtag API 或該標籤內容受限。建議使用「模糊搜尋 (ig_fuzzy_search_posts)」、「指定帳號 (get_user_medias)」或「動態探索 (get_timeline_feed)」。"

        return {
            "ok": True,
            "hashtag": tag,
            "count": len(results),
            "posts": results,
            "status": "success" if len(results) > 0 else "restricted_or_empty",
            "notice": notice,
            "api_warning": api_error,
        }

    def get_user_medias(self, username: str, limit: int = 10) -> Dict[str, Any]:
        """指定帳號讀取最新貼文與影片 (純瀏覽、安全只讀不發文)"""
        clean_user = username.lstrip("@").strip()
        self._apply_read_pacing(1.5, 3.0)
        logger.info(f"Fetching user medias for @{clean_user} (limit={limit})...")
        try:
            try:
                user_id = self.cl.user_id_from_username(clean_user)
            except Exception as e:
                return {
                    "ok": False,
                    "error": f"找不到使用者 @{clean_user}: {e}",
                    "username": clean_user,
                    "posts": [],
                }

            user_meta = {}
            try:
                uinfo = self.cl.user_info(user_id)
                user_meta = {
                    "pk": str(uinfo.pk),
                    "username": str(uinfo.username),
                    "full_name": str(uinfo.full_name),
                    "biography": str(uinfo.biography or ""),
                    "media_count": int(uinfo.media_count or 0),
                    "follower_count": int(uinfo.follower_count or 0),
                    "following_count": int(uinfo.following_count or 0),
                    "is_private": bool(uinfo.is_private),
                    "is_verified": bool(uinfo.is_verified),
                    "profile_pic_url": str(uinfo.profile_pic_url or ""),
                }
            except Exception as ue:
                logger.warning(f"Could not fetch full user_info for {clean_user}: {ue}")

            if user_meta.get("is_private") and not user_meta.get("media_count"):
                return {
                    "ok": True,
                    "user": user_meta,
                    "count": 0,
                    "posts": [],
                    "message": f"帳號 @{clean_user} 為不公開私人帳號，需獲准追蹤才能查看貼文",
                }

            if user_meta.get("media_count") == 0:
                return {
                    "ok": True,
                    "user": user_meta,
                    "count": 0,
                    "posts": [],
                    "message": f"帳號 @{clean_user} 的公開貼文數為 0（可能為非官方或閒置帳號）",
                }

            medias = []
            try:
                medias = self.cl.user_medias(user_id, amount=limit)
            except Exception as me:
                logger.warning(f"user_medias returned error for {clean_user}: {me}")

            # 若一般貼文為空但該帳號確實有貼文（現代許多媒體全數發布為 Reels），回退抓取短片
            if not medias and user_meta.get("media_count", 0) > 0:
                try:
                    logger.info(f"user_medias is empty for @{clean_user}, trying user_clips fallback...")
                    medias = self.cl.user_clips(user_id, amount=limit)
                except Exception as ce:
                    logger.warning(f"user_clips fallback error for {clean_user}: {ce}")

            posts = []
            for m in medias:
                parsed = self._parse_media_item(m)
                if parsed:
                    posts.append(parsed)

            return {
                "ok": True,
                "user": user_meta,
                "count": len(posts),
                "posts": posts,
            }
        except Exception as e:
            logger.error(f"Failed to fetch user medias for @{clean_user}: {e}")
            return {"ok": False, "error": str(e), "username": clean_user, "posts": []}

    def get_user_clips(self, username: str, limit: int = 10) -> Dict[str, Any]:
        """指定帳號專門讀取連續短片 (Reels / Clips)"""
        clean_user = username.lstrip("@").strip()
        self._apply_read_pacing(1.5, 3.0)
        logger.info(f"Fetching Reels for @{clean_user} (limit={limit})...")
        try:
            user_id = self.cl.user_id_from_username(clean_user)
            clips = self.cl.user_clips(user_id, amount=limit)
            reels = []
            for c in clips:
                parsed = self._parse_media_item(c)
                if parsed:
                    parsed["is_reel"] = True
                    reels.append(parsed)
            return {
                "ok": True,
                "username": clean_user,
                "count": len(reels),
                "reels": reels,
            }
        except Exception as e:
            logger.error(f"Failed to fetch user clips for @{clean_user}: {e}")
            return {"ok": False, "error": str(e), "username": clean_user, "reels": []}

    def get_reels_feed(self, limit: int = 10) -> Dict[str, Any]:
        """瀏覽熱門與探索 Reels / 短影音 (唯讀瀏覽)"""
        self._apply_read_pacing(1.5, 3.0)
        logger.info(f"Fetching Explore Reels feed (limit={limit})...")
        try:
            # instagrapi 沒有 explore_posts；探索短片要用 explore_reels
            posts = self.cl.explore_reels(amount=max(1, limit))
            reels = []
            for m in posts:
                parsed = self._parse_media_item(m)
                if parsed:
                    reels.append(parsed)
                    if len(reels) >= limit:
                        break

            return {
                "ok": True,
                "count": len(reels),
                "reels": reels,
            }
        except Exception as e:
            logger.error(f"Failed to fetch reels feed: {e}")
            return {"ok": False, "error": str(e), "reels": []}

    def search_users(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """搜尋 Instagram 用戶帳號"""
        q = query.lstrip("@").strip()
        if not q:
            return []
        self._apply_read_pacing(1.0, 2.0)
        logger.info(f"Searching users: {q}...")
        try:
            users = self.cl.search_users(q)
            results = []
            for u in users[:limit]:
                results.append({
                    "pk": str(getattr(u, "pk", "")),
                    "username": str(getattr(u, "username", "")),
                    "full_name": str(getattr(u, "full_name", "")),
                    "is_private": bool(getattr(u, "is_private", False)),
                    "is_verified": bool(getattr(u, "is_verified", False)),
                    "profile_pic_url": str(getattr(u, "profile_pic_url", "") or ""),
                })
            return results
        except Exception as e:
            logger.error(f"search_users error: {e}")
            return []

    def search_tags(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """搜尋 Instagram 標籤"""
        q = query.lstrip("#").strip()
        if not q:
            return []
        self._apply_read_pacing(1.0, 2.0)
        logger.info(f"Searching tags: #{q}...")
        try:
            tags = self.cl.search_hashtags(q)
            results = []
            for t in tags[:limit]:
                results.append({
                    "name": str(getattr(t, "name", "")),
                    "media_count": int(getattr(t, "media_count", 0) or 0),
                })
            return results
        except Exception as e:
            logger.error(f"search_tags error: {e}")
            return []

    def get_post_context(self, media_pk: str, comment_limit: int = 15) -> Dict[str, Any]:
        """抓取特定貼文或 Reel 的完整上下文（內文、標題、無障礙視覺描述、音訊配樂、字幕與包含子留言的完整評論列表）"""
        self._apply_read_pacing(1.0, 2.5)
        clean_pk = str(media_pk).strip().split("_")[0]
        logger.info(f"Fetching full post/reel context for media PK: {clean_pk}...")

        parsed_media: Optional[Dict[str, Any]] = None
        video_subtitles_text = ""

        # 1. 優先使用底層 private_request("media/{pk}/info/") 取得完整原始字典
        #    避免 instagrapi media_info 對新版 Reels / Clips 因 Pydantic 欄位變動拋出驗證錯誤，
        #    並能完整提取 accessibility_caption、clips_metadata (音樂/原聲)、video_subtitles_uri 與多張圖片 URL
        try:
            raw_info = self.cl.private_request(f"media/{clean_pk}/info/")
            items = raw_info.get("items") if isinstance(raw_info, dict) else None
            if isinstance(items, list) and len(items) > 0 and isinstance(items[0], dict):
                item0 = items[0]
                parsed_media = self._parse_media_item(item0)
                sub_uri = str(item0.get("video_subtitles_uri") or "")
                if sub_uri:
                    try:
                        import urllib.request
                        import re as _re
                        req = urllib.request.Request(sub_uri, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=5) as resp:
                            sub_raw = resp.read().decode("utf-8", errors="ignore")
                            lines = []
                            for ln in sub_raw.splitlines():
                                ln_s = ln.strip()
                                if not ln_s or ln_s.startswith("WEBVTT") or "-->" in ln_s or ln_s.isdigit():
                                    continue
                                clean_ln = _re.sub(r"<[^>]+>", "", ln_s).strip()
                                if clean_ln and (not lines or lines[-1] != clean_ln):
                                    lines.append(clean_ln)
                            video_subtitles_text = " ".join(lines)[:1000]
                    except Exception as sub_err:
                        logger.debug(f"Fetch video_subtitles_uri notice: {sub_err}")
        except Exception as raw_err:
            logger.debug(f"private_request media info fallback for {clean_pk}: {raw_err}")

        # 2. 若 private_request 未取得，回退使用 instagrapi media_info
        if not parsed_media:
            try:
                media = self.cl.media_info(clean_pk)
                parsed_media = self._parse_media_item(media) or {
                    "pk": str(media.pk),
                    "code": str(media.code),
                    "caption": str(media.caption_text or ""),
                    "like_count": int(getattr(media, "like_count", 0) or 0),
                    "comment_count": int(getattr(media, "comment_count", 0) or 0),
                    "user": {
                        "pk": str(getattr(media.user, "pk", "")),
                        "username": str(getattr(media.user, "username", "")),
                    } if hasattr(media, "user") and media.user else {},
                    "url": f"https://www.instagram.com/p/{media.code}/",
                }
            except Exception as e:
                logger.error(f"Failed to fetch media_info for {clean_pk}: {e}")
                return {"error": f"Failed to get media info: {e}", "ok": False}

        if video_subtitles_text:
            parsed_media["video_subtitles"] = video_subtitles_text

        # 3. 抓取貼文或 Reel 的留言與巢狀子留言 (preview_child_comments)
        comments_data: List[Dict[str, Any]] = []
        seen_comment_pks = set()
        try:
            raw_cmt_res = self.cl.private_request(
                f"media/{clean_pk}/comments/",
                params={"can_support_threading": "true", "permalink_enabled": "false"},
            )
            if isinstance(raw_cmt_res, dict):
                raw_list = raw_cmt_res.get("comments") or []
                for c in raw_list[: max(comment_limit, 20)]:
                    if not isinstance(c, dict):
                        continue
                    c_pk = str(c.get("pk") or "")
                    c_text = str(c.get("text") or "")
                    c_user = c.get("user") or {}
                    c_username = str(c_user.get("username") or "")
                    if c_pk and c_pk not in seen_comment_pks:
                        seen_comment_pks.add(c_pk)
                        comments_data.append({
                            "pk": c_pk,
                            "text": c_text,
                            "user": {
                                "pk": str(c_user.get("pk") or ""),
                                "username": c_username,
                            },
                            "created_at_utc": str(c.get("created_at_utc") or c.get("created_at") or ""),
                            "parent_comment_pk": "",
                            "parent_comment_user": "",
                            "parent_comment_text": "",
                        })
                    # 同時展開 preview_child_comments (樓中樓子留言被 @ 的情況)
                    for child in c.get("preview_child_comments") or []:
                        if not isinstance(child, dict):
                            continue
                        ch_pk = str(child.get("pk") or "")
                        ch_text = str(child.get("text") or "")
                        ch_user = child.get("user") or {}
                        ch_username = str(ch_user.get("username") or "")
                        if ch_pk and ch_pk not in seen_comment_pks:
                            seen_comment_pks.add(ch_pk)
                            comments_data.append({
                                "pk": ch_pk,
                                "text": ch_text,
                                "user": {
                                    "pk": str(ch_user.get("pk") or ""),
                                    "username": ch_username,
                                },
                                "created_at_utc": str(child.get("created_at_utc") or child.get("created_at") or ""),
                                "parent_comment_pk": c_pk,
                                "parent_comment_user": c_username,
                                "parent_comment_text": c_text,
                            })
        except Exception as raw_cmt_err:
            logger.debug(f"private_request comments fallback for {clean_pk}: {raw_cmt_err}")

        if not comments_data:
            try:
                raw_comments = self.cl.media_comments(clean_pk, amount=comment_limit)
                for c in raw_comments:
                    c_pk = str(c.pk)
                    if c_pk not in seen_comment_pks:
                        seen_comment_pks.add(c_pk)
                        comments_data.append({
                            "pk": c_pk,
                            "text": str(c.text or ""),
                            "user": {
                                "pk": str(getattr(c.user, "pk", "")),
                                "username": str(getattr(c.user, "username", "")),
                            } if hasattr(c, "user") and c.user else {},
                            "created_at_utc": c.created_at_utc.isoformat() if hasattr(c, "created_at_utc") and c.created_at_utc else "",
                        })
            except Exception as e:
                logger.warning(f"Failed to fetch comments for {clean_pk}: {e}")

        return {
            "ok": True,
            "media": parsed_media,
            "comments": comments_data,
        }

    def get_recent_mentions(self, limit: int = 20) -> Dict[str, Any]:
        """從 Instagram 通知收件匣 (news/inbox) 探索近期提及 (@mention) 或回覆機器人的貼文與 Reel PK 清單"""
        self._apply_read_pacing(1.0, 2.0)
        logger.info(f"Checking news/inbox for recent @mentions and comment replies (limit={limit})...")
        media_pks: List[str] = []
        mention_items: List[Dict[str, Any]] = []
        try:
            inbox = self.cl.private_request("news/inbox/", params={"mark_as_seen": "false"})
            if isinstance(inbox, dict):
                stories = (inbox.get("new_stories") or []) + (inbox.get("old_stories") or [])
                for st in stories:
                    if not isinstance(st, dict):
                        continue
                    args = st.get("args") or {}
                    if not isinstance(args, dict):
                        continue
                    text = str(args.get("text") or args.get("rich_text") or "")
                    notif_name = str(st.get("notif_name") or "")
                    story_type = st.get("type")
                    # 擷取通知關聯的 media pk
                    medias = args.get("media") or []
                    found_pk = ""
                    if isinstance(medias, list) and len(medias) > 0 and isinstance(medias[0], dict):
                        raw_id = str(medias[0].get("id") or medias[0].get("pk") or "")
                        found_pk = raw_id.split("_")[0].strip()
                    if not found_pk:
                        dest = str(args.get("destination") or "")
                        if "media?id=" in dest:
                            found_pk = dest.split("media?id=")[-1].split("&")[0].split("_")[0].strip()

                    if found_pk and found_pk.isdigit():
                        comment_id = str(args.get("comment_id") or "")
                        if found_pk not in media_pks:
                            media_pks.append(found_pk)
                        mention_items.append({
                            "media_pk": found_pk,
                            "comment_pk": comment_id,
                            "text": text,
                            "notif_name": notif_name,
                            "story_type": story_type,
                            "timestamp": str(args.get("timestamp") or ""),
                        })
                        if len(media_pks) >= limit:
                            break
        except Exception as e:
            logger.warning(f"get_recent_mentions news/inbox notice: {e}")
            return {"ok": False, "error": str(e), "media_pks": [], "mentions": []}

        return {
            "ok": True,
            "media_pks": media_pks,
            "mentions": mention_items[:limit],
        }

    def post_comment(
        self,
        media_pk: str,
        text: str,
        reply_to_comment_pk: Optional[str] = None,
        jitter_min: float = 6.0,
        jitter_max: float = 15.0,
    ) -> Dict[str, Any]:
        """在貼文下發布留言或作為巢狀子留言回覆（包含防風控頻次檢查與熔斷）"""
        perm = self.anti_risk.check_write_permission("comment")
        if not perm.get("allowed"):
            return {
                "ok": False,
                "in_cooldown": perm.get("in_cooldown", False),
                "cooldown_remaining_sec": perm.get("remaining_seconds", 0),
                "error": perm.get("reason", "防風控阻絕"),
            }

        self._apply_jitter(jitter_min, jitter_max)

        replied_id = int(reply_to_comment_pk) if reply_to_comment_pk and str(reply_to_comment_pk).isdigit() else None
        logger.info(f"Posting comment to media {media_pk} (reply_to={replied_id}): {text[:40]}...")

        try:
            cmt = self.cl.media_comment(
                media_id=media_pk,
                text=text,
                replied_to_comment_id=replied_id,
            )
            self.anti_risk.record_action("comment", f"media_pk={media_pk}")
            return {
                "ok": True,
                "comment_pk": str(cmt.pk),
                "text": cmt.text,
                "media_pk": str(media_pk),
                "reply_to": str(reply_to_comment_pk or ""),
                "status": "posted",
            }
        except FeedbackRequired as e:
            self.anti_risk.trigger_cooldown(30, f"FeedbackRequired (Instagram Action Blocked / 功能受限): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 功能受限 (Action Blocked)：{e}"}
        except PleaseWaitFewMinutes as e:
            self.anti_risk.trigger_cooldown(15, f"PleaseWaitFewMinutes (頻率過快): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 900, "error": f"Instagram 頻率管制：{e}"}
        except RateLimitError as e:
            self.anti_risk.trigger_cooldown(20, f"RateLimitError: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1200, "error": f"Instagram 速率受限：{e}"}
        except SentryBlock as e:
            self.anti_risk.trigger_cooldown(60, f"SentryBlock: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 3600, "error": f"Instagram Sentry 防護阻擋：{e}"}
        except ChallengeRequired as e:
            return {"ok": False, "challenge_required": True, "error": f"Instagram 安全挑戰 (Challenge Required)：{e}"}
        except LoginRequired as e:
            return {"ok": False, "login_required": True, "error": f"Instagram 登入憑證失效 (Login Required)：{e}"}
        except Exception as e:
            err_msg = str(e).lower()
            if "feedback_required" in err_msg or "action block" in err_msg or "checkpoint" in err_msg:
                self.anti_risk.trigger_cooldown(30, f"疑似風控阻擋：{e}")
                return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 疑似風控阻擋：{e}"}
            logger.error(f"Failed to post comment to media {media_pk}: {e}")
            return {"ok": False, "error": str(e)}

    def get_unread_dms(self, limit: int = 10) -> List[Dict[str, Any]]:
        """讀取未讀或最近的私訊線程（唯讀，自帶讀取微延遲）"""
        self._apply_read_pacing(1.0, 2.5)
        logger.info(f"Fetching direct threads (limit={limit})...")
        threads = []
        try:
            threads = self.cl.direct_threads(amount=limit, selected_filter="unread")
        except Exception as e:
            logger.warning(f"direct_threads(unread) failed: {e}")

        # 若 unread filter 未抓到任何線程（已被點開看過、或帳號類型不支援該 filter），fallback 抓取全部最近對話
        if not threads:
            try:
                threads = self.cl.direct_threads(amount=limit)
            except Exception as e2:
                logger.error(f"Failed to fetch direct threads: {e2}")
                threads = []

        # 同時抓取 pending (訊息要求 / Message Requests)，確保陌生私訊與請求不被遺漏
        try:
            pending = self.cl.direct_pending_inbox()
            if isinstance(pending, list):
                existing_ids = {str(getattr(t, "id", "")) for t in threads}
                for pt in pending:
                    if str(getattr(pt, "id", "")) not in existing_ids:
                        threads.append(pt)
        except Exception as pe:
            logger.debug(f"direct_pending_inbox check: {pe}")

        results = []
        current_user_id = str(getattr(self.cl, "user_id", ""))

        for t in threads:
            try:
                thread_users = []
                for u in getattr(t, "users", []):
                    thread_users.append({
                        "pk": str(getattr(u, "pk", "")),
                        "username": str(getattr(u, "username", "")),
                        "full_name": str(getattr(u, "full_name", "")),
                    })

                last_msg = None
                messages = getattr(t, "messages", [])
                if messages:
                    m = messages[0]
                    last_msg = {
                        "id": str(getattr(m, "id", "")),
                        "user_id": str(getattr(m, "user_id", "")),
                        "text": str(getattr(m, "text", "") or ""),
                        "timestamp": m.timestamp.isoformat() if hasattr(m, "timestamp") and m.timestamp else "",
                        "is_outgoing": str(getattr(m, "user_id", "")) == current_user_id,
                    }

                is_unread = bool(getattr(t, "unread_count", 0) > 0)
                if not is_unread and last_msg and not last_msg.get("is_outgoing"):
                    is_unread = True

                results.append({
                    "thread_id": str(t.id),
                    "title": str(getattr(t, "thread_title", "") or ""),
                    "users": thread_users,
                    "unread": is_unread,
                    "last_message": last_msg,
                })
            except Exception as err:
                logger.warning(f"Error parsing thread {getattr(t, 'id', '')}: {err}")
                continue

        logger.info(f"Retrieved {len(results)} direct threads")
        return results

    def send_dm(
        self,
        thread_id: str,
        text: str,
        jitter_min: float = 6.0,
        jitter_max: float = 15.0,
    ) -> Dict[str, Any]:
        """發送私訊到指定對話線程（包含防風控頻次檢查與熔斷）"""
        perm = self.anti_risk.check_write_permission("dm")
        if not perm.get("allowed"):
            return {
                "ok": False,
                "in_cooldown": perm.get("in_cooldown", False),
                "cooldown_remaining_sec": perm.get("remaining_seconds", 0),
                "error": perm.get("reason", "防風控阻絕"),
            }

        self._apply_jitter(jitter_min, jitter_max)

        logger.info(f"Sending DM to thread {thread_id}: {text[:40]}...")
        try:
            result = self.cl.direct_send(text=text, thread_ids=[thread_id])
            msg_id = getattr(result, "id", "") if hasattr(result, "id") else ""
            self.anti_risk.record_action("dm", f"thread_id={thread_id}")
            return {
                "ok": True,
                "thread_id": thread_id,
                "message_id": str(msg_id),
                "status": "sent",
            }
        except FeedbackRequired as e:
            self.anti_risk.trigger_cooldown(30, f"FeedbackRequired (Instagram Action Blocked / 功能受限): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 功能受限 (Action Blocked)：{e}"}
        except PleaseWaitFewMinutes as e:
            self.anti_risk.trigger_cooldown(15, f"PleaseWaitFewMinutes (頻率過快): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 900, "error": f"Instagram 頻率管制：{e}"}
        except RateLimitError as e:
            self.anti_risk.trigger_cooldown(20, f"RateLimitError: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1200, "error": f"Instagram 速率受限：{e}"}
        except SentryBlock as e:
            self.anti_risk.trigger_cooldown(60, f"SentryBlock: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 3600, "error": f"Instagram Sentry 防護阻擋：{e}"}
        except ChallengeRequired as e:
            return {"ok": False, "challenge_required": True, "error": f"Instagram 安全挑戰 (Challenge Required)：{e}"}
        except LoginRequired as e:
            return {"ok": False, "login_required": True, "error": f"Instagram 登入憑證失效 (Login Required)：{e}"}
        except Exception as e:
            err_msg = str(e).lower()
            if "feedback_required" in err_msg or "action block" in err_msg or "checkpoint" in err_msg:
                self.anti_risk.trigger_cooldown(30, f"疑似風控阻擋：{e}")
                return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 疑似風控阻擋：{e}"}
            logger.error(f"Failed to send DM to thread {thread_id}: {e}")
            return {"ok": False, "error": str(e)}

    def get_timeline_feed(self, limit: int = 10) -> List[Dict[str, Any]]:
        """讀取時間軸動態牆 (Timeline Feed) 或探索貼文，支援動態滾動探索（自帶微延遲）"""
        self._apply_read_pacing(1.5, 3.0)
        logger.info(f"Fetching timeline/explore feed (limit={limit})...")
        results = []
        seen_pks = set()
        try:
            try:
                raw_items = self.cl.get_timeline_feed()
                if isinstance(raw_items, dict):
                    if "feed_items" in raw_items:
                        for item in raw_items.get("feed_items", []):
                            m = item.get("media_or_ad") or item.get("explore_story", {}).get("media_or_ad")
                            if m and not item.get("is_ad") and not m.get("dr_ad_type"):
                                parsed = self._parse_media_item(m)
                                if parsed and parsed.get("pk") not in seen_pks:
                                    seen_pks.add(parsed.get("pk"))
                                    results.append(parsed)
                                    if len(results) >= limit:
                                        break
                    if len(results) < limit:
                        for parsed in self._extract_medias_from_raw(raw_items, limit=limit):
                            pk = parsed.get("pk")
                            if pk and pk not in seen_pks:
                                seen_pks.add(pk)
                                results.append(parsed)
                                if len(results) >= limit:
                                    break
            except Exception as e:
                logger.warning(f"get_timeline_feed fallback: {e}")

            if not results:
                try:
                    # 限制單次 explore_reels 數量，避免多次分頁請求導致超過 MCP timeout
                    explore_posts = self.cl.explore_reels(amount=max(1, min(limit, 8)))
                    for m in explore_posts:
                        parsed = self._parse_media_item(m)
                        if parsed and parsed.get("pk") not in seen_pks:
                            seen_pks.add(parsed.get("pk"))
                            results.append(parsed)
                except Exception as ex:
                    logger.error(f"explore_reels fallback failed: {ex}")
                    return []

            return results[:limit]
        except Exception as e:
            logger.error(f"Failed to fetch timeline feed: {e}")
            return []

    def like_media(self, media_pk: str) -> Dict[str, Any]:
        """對指定貼文點讚（包含防風控頻次檢查與熔斷）"""
        perm = self.anti_risk.check_write_permission("like")
        if not perm.get("allowed"):
            return {
                "ok": False,
                "in_cooldown": perm.get("in_cooldown", False),
                "cooldown_remaining_sec": perm.get("remaining_seconds", 0),
                "error": perm.get("reason", "防風控阻絕"),
                "media_pk": media_pk,
            }

        self._apply_jitter(3.0, 7.0)
        try:
            ok = self.cl.media_like(media_pk)
            self.anti_risk.record_action("like", f"media_pk={media_pk}")
            return {"ok": bool(ok), "media_pk": media_pk, "status": "liked"}
        except FeedbackRequired as e:
            self.anti_risk.trigger_cooldown(30, f"FeedbackRequired (點讚觸發 Action Blocked): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 功能受限 (Action Blocked)：{e}", "media_pk": media_pk}
        except PleaseWaitFewMinutes as e:
            self.anti_risk.trigger_cooldown(15, f"PleaseWaitFewMinutes (點讚頻率過快): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 900, "error": f"Instagram 頻率管制：{e}", "media_pk": media_pk}
        except Exception as e:
            logger.error(f"Failed to like media {media_pk}: {e}")
            return {"ok": False, "error": str(e), "media_pk": media_pk}

    def get_anti_risk_status(self) -> Dict[str, Any]:
        """獲取目前防風控狀態、熔斷冷卻倒數與最近動作統計"""
        return self.anti_risk.get_status()

    def reset_anti_risk_cooldown(self) -> Dict[str, Any]:
        """手動解除防風控熔斷冷卻狀態"""
        self.anti_risk.reset_cooldown()
        return {"ok": True, "message": "已成功解除防風控冷卻狀態"}

    def resolve_media_pk(self, media_pk_or_url: str) -> str:
        """將貼文/Reel 的 PK、Shortcode 或完整 Instagram 網址解析為純數字 Media PK"""
        raw = str(media_pk_or_url or "").strip()
        if not raw:
            return ""
        # 1. 若為純數字或 pk_userid 格式
        first_part = raw.split("_")[0].strip()
        if first_part.isdigit():
            return first_part
        # 2. 若為完整網址 (https://www.instagram.com/reel/xxx/ 或 /p/xxx/)
        if "instagram.com/" in raw or raw.startswith("http"):
            try:
                return str(self.cl.media_pk_from_url(raw))
            except Exception as e:
                logger.debug(f"media_pk_from_url fallback: {e}")
                import re as _re
                m = _re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", raw)
                if m:
                    raw = m.group(1)
        # 3. 視為 Shortcode 解析
        try:
            return str(self.cl.media_pk_from_code(raw.strip("/")))
        except Exception as e:
            logger.warning(f"Failed to resolve media_pk from '{media_pk_or_url}': {e}")
            return ""

    def _render_repost_story_canvas(
        self,
        thumbnail_url: str,
        author_username: str,
        caption_text: str,
        mention_usernames: List[str],
        is_reel: bool = False,
    ):
        """使用 Pillow 繪製 9:16 (1080x1920) 質感限時動態轉發背景圖（含原貼文縮圖、@用戶標記與感想文案）"""
        import os
        import tempfile
        import urllib.request
        from io import BytesIO
        from pathlib import Path
        from PIL import Image, ImageDraw, ImageFont

        W, H = 1080, 1920
        canvas = Image.new("RGB", (W, H), (18, 20, 28))
        draw = ImageDraw.Draw(canvas)

        # 繪製深色柔和漸層背景與卡片底框
        for y in range(H):
            r = int(16 + (y / H) * 14)
            g = int(18 + (y / H) * 18)
            b = int(28 + (y / H) * 26)
            draw.line([(0, y), (W, y)], fill=(r, g, b))

        # 載入中文字型 (Windows 微軟正黑體 / macOS PingFang / Linux Noto)
        font_Paths = [
            r"C:\Windows\Fonts\msjhbd.ttc",
            r"C:\Windows\Fonts\msjh.ttc",
            r"C:\Windows\Fonts\simhei.ttf",
            "/System/Library/Fonts/PingFang.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        ]
        font_path = next((p for p in font_Paths if os.path.exists(p)), None)

        def get_font(size: int):
            if font_path:
                try:
                    return ImageFont.truetype(font_path, size)
                except Exception:
                    pass
            return ImageFont.load_default()

        font_header = get_font(34)
        font_body = get_font(38)
        font_mention = get_font(36)

        # 1. 上半部繪製原貼文/Reel 縮圖預覽區 (對應 StoryMedia 可點擊貼紙位置 x=0.5, y=0.38)
        card_x1, card_y1, card_x2, card_y2 = 90, 160, 990, 1180
        draw.rounded_rectangle(
            [card_x1, card_y1, card_x2, card_y2],
            radius=36,
            fill=(28, 32, 44),
            outline=(68, 76, 102),
            width=2,
        )

        badge_label = "🔁 REEL 轉發分享" if is_reel else "🔁 貼文轉發分享"
        header_str = f"{badge_label}  •  @{author_username}" if author_username else badge_label
        draw.text((card_x1 + 36, card_y1 + 26), header_str, font=font_header, fill=(180, 195, 230))

        if thumbnail_url:
            try:
                req = urllib.request.Request(thumbnail_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    img_bytes = resp.read()
                thumb = Image.open(BytesIO(img_bytes)).convert("RGB")
                target_w = 828
                target_h = 880
                thumb.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
                paste_x = card_x1 + (900 - thumb.width) // 2
                paste_y = card_y1 + 92 + (target_h - thumb.height) // 2
                canvas.paste(thumb, (paste_x, paste_y))
            except Exception as img_err:
                logger.debug(f"Story thumbnail render fallback: {img_err}")

        # 2. 下半部繪製「轉發文案（含 @用戶 與對該 Reel/貼文的感想）」卡片區
        thought_y1 = 1230
        thought_y2 = 1780
        draw.rounded_rectangle(
            [90, thought_y1, 990, thought_y2],
            radius=32,
            fill=(26, 30, 42),
            outline=(88, 130, 225),
            width=2,
        )

        # 自動斷行排版感想文字
        clean_text = (caption_text or "").strip()
        lines: List[str] = []
        for para in clean_text.splitlines():
            para = para.strip()
            if not para:
                continue
            buf = ""
            for ch in para:
                buf += ch
                # 約每行 21 個中文字寬度換行
                if len(buf) >= 21:
                    lines.append(buf)
                    buf = ""
            if buf:
                lines.append(buf)
            if len(lines) >= 7:
                break

        text_y = thought_y1 + 42
        for line in lines[:7]:
            draw.text((132, text_y), line, font=font_body, fill=(242, 245, 252))
            text_y += 54

        # 3. 底部繪製醒目的 @mention 標籤提示區 (對應 StoryMention 位置 y=0.86)
        if mention_usernames:
            mention_line = "  ".join([f"@{u.lstrip('@')}" for u in mention_usernames[:4]])
            draw.text((132, thought_y2 - 70), mention_line, font=font_mention, fill=(115, 185, 255))

        temp_file = tempfile.NamedTemporaryFile(prefix="dsh_ig_repost_story_", suffix=".jpg", delete=False)
        temp_file.close()
        out_path = Path(temp_file.name)
        canvas.save(out_path, format="JPEG", quality=94)
        return out_path

    def repost_media(
        self,
        media_pk_or_url: str,
        caption: str = "",
        mention_users: Optional[List[str]] = None,
        repost_mode: str = "story",
        include_credit: bool = True,
        jitter_min: float = 5.0,
        jitter_max: float = 12.0,
    ) -> Dict[str, Any]:
        """轉發指定的 Instagram 貼文或 Reel，支援在轉發文案中 @用戶 並填寫對該貼文/Reel 內容的感想。

        Args:
            media_pk_or_url: 貼文/Reel 的 Media PK、Shortcode 或完整網址
            caption: 轉發文案（可包含 @用戶 與對這則 Reel/貼文內容的感想）
            mention_users: 欲在轉發時 @標記 的 Instagram 帳號清單（可不帶 @）
            repost_mode: 轉發模式：
                - "story" (預設)：轉發至限時動態（含可點擊跳轉原貼文的 StoryMedia 貼紙 + StoryMention @用戶通知 + 感想文字視覺卡片）
                - "feed"：下載原貼文/Reel 並轉發至動態牆/Reels（附上感想文案、@用戶、Usertag 標記與原創作者出處）
                - "dm"：將該貼文/Reel 轉發分享至目標 @用戶 的私訊並附上感想文字
            include_credit: 動態牆轉發時是否自動附上原創作者標註 (預設 True)
            jitter_min: 防風控最小隨機延遲秒數
            jitter_max: 防風控最大隨機延遲秒數
        """
        perm = self.anti_risk.check_write_permission("repost")
        if not perm.get("allowed"):
            return {
                "ok": False,
                "in_cooldown": perm.get("in_cooldown", False),
                "cooldown_remaining_sec": perm.get("remaining_seconds", 0),
                "error": perm.get("reason", "防風控阻絕"),
            }

        clean_pk = self.resolve_media_pk(media_pk_or_url)
        if not clean_pk:
            return {
                "ok": False,
                "error": f"無法解析貼文或 Reel 識別碼: {media_pk_or_url}",
            }

        # 1. 讀取原貼文或 Reel 的完整資訊
        ctx_res = self.get_post_context(clean_pk, comment_limit=5)
        media_data = ctx_res.get("media") if isinstance(ctx_res, dict) else None
        if not media_data or not isinstance(media_data, dict):
            return {
                "ok": False,
                "media_pk": clean_pk,
                "error": f"無法讀取原貼文/Reel ({clean_pk}) 的媒體資訊",
            }

        orig_author = str((media_data.get("user") or {}).get("username") or "")
        orig_author_pk = str((media_data.get("user") or {}).get("pk") or "")
        is_reel = bool(media_data.get("is_reel"))
        is_video = bool(media_data.get("is_video"))
        thumb_url = str(
            media_data.get("thumbnail_url")
            or ((media_data.get("image_urls") or [""])[0] if media_data.get("image_urls") else "")
        )
        video_url = str(media_data.get("video_url") or "")
        orig_url = str(media_data.get("url") or f"https://www.instagram.com/p/{media_data.get('code', '')}/")

        # 2. 整理要 @ 的用戶清單與轉發感想文案
        import re as _re

        clean_mentions: List[str] = []
        for u in mention_users or []:
            cu = str(u or "").lstrip("@").strip()
            if cu and cu.lower() not in [x.lower() for x in clean_mentions]:
                clean_mentions.append(cu)

        # 從 caption 中也提取已經寫入的 @username
        caption_str = str(caption or "").strip()
        for m_user in _re.findall(r"@([A-Za-z0-9._]+)", caption_str):
            if m_user and m_user.lower() not in [x.lower() for x in clean_mentions]:
                clean_mentions.append(m_user)

        # 確保所有指定的 mention_users 都有出現在轉發文案裡
        missing_prefix = [
            f"@{u}" for u in clean_mentions if f"@{u.lower()}" not in caption_str.lower()
        ]
        if missing_prefix:
            full_caption = f"{' '.join(missing_prefix)} {caption_str}".strip()
        else:
            full_caption = caption_str

        # 解析被 @ 用戶的 UserShort 資訊（供 StoryMention、Usertag 與 DM 轉發使用）
        from instagrapi.types import StoryMedia, StoryMention, UserShort, Usertag

        resolved_users: List[UserShort] = []
        for uname in clean_mentions[:5]:
            try:
                u_info = self.cl.user_info_by_username_v1(uname)
                if u_info and getattr(u_info, "pk", None):
                    resolved_users.append(
                        UserShort(
                            pk=str(u_info.pk),
                            username=str(u_info.username or uname),
                            full_name=str(getattr(u_info, "full_name", "") or ""),
                        )
                    )
                    continue
            except Exception:
                pass
            try:
                searched = self.cl.search_users(uname)
                for su in searched or []:
                    if str(getattr(su, "username", "")).lower() == uname.lower():
                        resolved_users.append(
                            UserShort(
                                pk=str(su.pk),
                                username=str(su.username),
                                full_name=str(getattr(su, "full_name", "") or ""),
                            )
                        )
                        break
            except Exception:
                pass

        self._apply_jitter(jitter_min, jitter_max)
        mode = str(repost_mode or "story").lower().strip()

        try:
            # ==================================================================
            # 模式 A: 限時動態轉發 (Story Reshare + @用戶 Mention + 感想文字卡片)
            # ==================================================================
            if mode in ("story", "reshare", "story_reshare"):
                bg_path = None
                try:
                    bg_path = self._render_repost_story_canvas(
                        thumbnail_url=thumb_url,
                        author_username=orig_author,
                        caption_text=full_caption,
                        mention_usernames=clean_mentions,
                        is_reel=is_reel,
                    )
                    story_mentions = [
                        StoryMention(
                            user=u_short,
                            x=0.5,
                            y=0.86,
                            width=0.55,
                            height=0.1,
                        )
                        for u_short in resolved_users
                    ]
                    story_media = StoryMedia(
                        media_pk=int(clean_pk),
                        user_id=int(orig_author_pk) if orig_author_pk.isdigit() else None,
                        x=0.5,
                        y=0.38,
                        width=0.82,
                        height=0.52,
                    )
                    story_obj = self.cl.photo_upload_to_story(
                        bg_path,
                        caption=full_caption,
                        mentions=story_mentions,
                        medias=[story_media],
                    )
                    story_pk = str(getattr(story_obj, "pk", "") or getattr(story_obj, "id", ""))
                    self.anti_risk.record_action("repost_story", f"media_pk={clean_pk}")
                    return {
                        "ok": True,
                        "repost_mode": "story",
                        "source_media_pk": clean_pk,
                        "source_url": orig_url,
                        "source_author": orig_author,
                        "repost_pk": story_pk,
                        "caption": full_caption,
                        "mentioned_users": clean_mentions,
                        "status": "reposted_to_story",
                    }
                finally:
                    if bg_path:
                        try:
                            bg_path.unlink(missing_ok=True)
                        except Exception:
                            pass

            # ==================================================================
            # 模式 B: 動態牆 / Reels 貼文轉發 (Feed / Reel Repost + @用戶 + 感想文案)
            # ==================================================================
            elif mode in ("feed", "post", "reel"):
                import tempfile
                import urllib.request
                from pathlib import Path

                feed_caption = full_caption
                if include_credit and orig_author and f"@{orig_author.lower()}" not in feed_caption.lower():
                    feed_caption = f"{feed_caption}\n\n🔁 轉發自 @{orig_author}".strip()

                usertags = [
                    Usertag(user=u_short, x=0.5, y=0.5)
                    for u_short in resolved_users
                ]

                tmp_media_path = None
                try:
                    if is_video and video_url:
                        tmp_f = tempfile.NamedTemporaryFile(prefix="dsh_ig_repost_vid_", suffix=".mp4", delete=False)
                        tmp_f.close()
                        tmp_media_path = Path(tmp_f.name)
                        req = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=25) as resp:
                            tmp_media_path.write_bytes(resp.read())

                        try:
                            uploaded = self.cl.clip_upload(
                                tmp_media_path,
                                caption=feed_caption,
                                usertags=usertags,
                            )
                        except Exception:
                            uploaded = self.cl.video_upload(
                                tmp_media_path,
                                caption=feed_caption,
                                usertags=usertags,
                            )
                    else:
                        if not thumb_url:
                            return {"ok": False, "error": "原貼文無可用的圖片或影片 URL 可供下載轉發"}
                        tmp_f = tempfile.NamedTemporaryFile(prefix="dsh_ig_repost_img_", suffix=".jpg", delete=False)
                        tmp_f.close()
                        tmp_media_path = Path(tmp_f.name)
                        req = urllib.request.Request(thumb_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=15) as resp:
                            tmp_media_path.write_bytes(resp.read())

                        uploaded = self.cl.photo_upload(
                            tmp_media_path,
                            caption=feed_caption,
                            usertags=usertags,
                        )

                    new_pk = str(getattr(uploaded, "pk", "") or getattr(uploaded, "id", ""))
                    new_code = str(getattr(uploaded, "code", "") or "")
                    self.anti_risk.record_action("repost_feed", f"media_pk={clean_pk}->new_pk={new_pk}")
                    return {
                        "ok": True,
                        "repost_mode": "feed",
                        "source_media_pk": clean_pk,
                        "source_url": orig_url,
                        "source_author": orig_author,
                        "repost_pk": new_pk,
                        "repost_code": new_code,
                        "repost_url": f"https://www.instagram.com/p/{new_code}/" if new_code else "",
                        "caption": feed_caption,
                        "mentioned_users": clean_mentions,
                        "status": "reposted_to_feed",
                    }
                finally:
                    if tmp_media_path:
                        try:
                            tmp_media_path.unlink(missing_ok=True)
                        except Exception:
                            pass
                        thumb_sidecar = Path(f"{tmp_media_path}.jpg")
                        if thumb_sidecar.exists():
                            try:
                                thumb_sidecar.unlink(missing_ok=True)
                            except Exception:
                                pass

            # ==================================================================
            # 模式 C: 私訊卡片轉發 (Direct Media Share + @用戶與對該貼文/Reel的感想)
            # ==================================================================
            elif mode in ("dm", "direct"):
                if not resolved_users:
                    return {
                        "ok": False,
                        "error": "私訊轉發模式 (dm) 需要至少指定一位有效的目標 @用戶 (mention_users)",
                    }
                recipient_ids = [int(u.pk) for u in resolved_users if str(u.pk).isdigit()]
                dm_share = self.cl.direct_media_share(
                    media_id=clean_pk,
                    user_ids=recipient_ids,
                    media_type="video" if is_video else "photo",
                )
                thread_id = str(getattr(dm_share, "thread_id", "") or "")
                if full_caption:
                    if thread_id:
                        self.cl.direct_send(text=full_caption, thread_ids=[int(thread_id)] if thread_id.isdigit() else [thread_id])
                    else:
                        self.cl.direct_send(text=full_caption, user_ids=recipient_ids)
                self.anti_risk.record_action("repost_dm", f"media_pk={clean_pk}")
                return {
                    "ok": True,
                    "repost_mode": "dm",
                    "source_media_pk": clean_pk,
                    "source_url": orig_url,
                    "source_author": orig_author,
                    "thread_id": thread_id,
                    "caption": full_caption,
                    "mentioned_users": clean_mentions,
                    "status": "reposted_to_dm",
                }

            else:
                return {
                    "ok": False,
                    "error": f"不支援的 repost_mode: {repost_mode}（請使用 'story'、'feed' 或 'dm'）",
                }

        except FeedbackRequired as e:
            self.anti_risk.trigger_cooldown(30, f"FeedbackRequired (轉發觸發 Action Blocked): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1800, "error": f"Instagram 功能受限 (Action Blocked)：{e}"}
        except PleaseWaitFewMinutes as e:
            self.anti_risk.trigger_cooldown(15, f"PleaseWaitFewMinutes (轉發頻率過快): {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 900, "error": f"Instagram 頻率管制：{e}"}
        except RateLimitError as e:
            self.anti_risk.trigger_cooldown(20, f"RateLimitError: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 1200, "error": f"Instagram 速率受限：{e}"}
        except SentryBlock as e:
            self.anti_risk.trigger_cooldown(60, f"SentryBlock: {e}")
            return {"ok": False, "in_cooldown": True, "cooldown_remaining_sec": 3600, "error": f"Instagram Sentry 防護阻擋：{e}"}
        except ChallengeRequired as e:
            return {"ok": False, "challenge_required": True, "error": f"Instagram 安全挑戰 (Challenge Required)：{e}"}
        except LoginRequired as e:
            return {"ok": False, "login_required": True, "error": f"Instagram 登入憑證失效 (Login Required)：{e}"}
        except Exception as e:
            logger.error(f"Failed to repost media {clean_pk} (mode={mode}): {e}")
            return {"ok": False, "media_pk": clean_pk, "error": str(e)}
