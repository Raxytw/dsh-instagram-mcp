import logging
import random
import time
from typing import List, Dict, Any, Optional
from instagrapi import Client

logger = logging.getLogger("instagram_mcp.core")


class InstagramCore:
    """Instagram 核心業務邏輯封裝 (搜尋、純瀏覽、Reel、貼文詳情、留言、私訊與防風控 Jitter)"""

    def __init__(self, client: Client):
        self.cl = client

    def _apply_jitter(self, min_sec: float = 3.0, max_sec: float = 6.0):
        """執行隨機抖動延遲，降低頻繁呼叫產生的風控風險"""
        delay = random.uniform(max(0.1, min_sec), max(min_sec, max_sec))
        logger.debug(f"Applying jitter delay: {delay:.2f} seconds...")
        time.sleep(delay)

    def _parse_media_item(self, m: Any) -> Optional[Dict[str, Any]]:
        """統一解析 Instagram 貼文/影片/Reel 資訊，包含聯名作者與短影音屬性"""
        if not m:
            return None
        try:
            if isinstance(m, dict):
                pk = str(m.get("pk") or m.get("id") or "")
                id_ = str(m.get("id") or "")
                code = str(m.get("code") or "")
                caption = str(m.get("caption", {}).get("text", "") if isinstance(m.get("caption"), dict) else (m.get("caption_text") or ""))
                like_count = int(m.get("like_count") or 0)
                comment_count = int(m.get("comment_count") or 0)
                view_count = int(m.get("view_count") or 0)
                media_type = int(m.get("media_type") or 1)
                product_type = str(m.get("product_type") or "feed")
                video_url = str(m.get("video_url") or "")
                thumbnail_url = str(m.get("thumbnail_url") or "")
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
                pk = str(getattr(m, "pk", ""))
                id_ = str(getattr(m, "id", ""))
                code = str(getattr(m, "code", ""))
                caption = str(getattr(m, "caption_text", "") or "")
                like_count = int(getattr(m, "like_count", 0) or 0)
                comment_count = int(getattr(m, "comment_count", 0) or 0)
                view_count = int(getattr(m, "view_count", 0) or 0)
                media_type = int(getattr(m, "media_type", 1) or 1)
                product_type = str(getattr(m, "product_type", "feed") or "feed")
                video_url = str(getattr(m, "video_url", "") or "")
                thumbnail_url = str(getattr(m, "thumbnail_url", "") or "")
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
                "caption": caption,
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
                "video_url": video_url,
                "user": user_info,
                "is_collaborative": len(coauthors) > 0,
                "coauthors": coauthors,
                "url": f"https://www.instagram.com/p/{code}/" if code else "",
                "taken_at": taken_at,
            }
        except Exception as err:
            logger.warning(f"Error parsing media item: {err}")
            return None

    def search_hashtag_posts(self, hashtag: str, limit: int = 10) -> Dict[str, Any]:
        """搜尋指定 Hashtag 的最新貼文，包含防空判定與詳細診斷"""
        tag = hashtag.lstrip("#").strip()
        if not tag:
            return {"ok": False, "error": "標籤名稱不可為空", "posts": []}

        logger.info(f"Searching hashtag #{tag} with limit {limit}...")
        medias = []
        api_error = None
        try:
            medias = self.cl.hashtag_medias_recent(tag, amount=limit)
        except Exception as e:
            logger.warning(f"hashtag_medias_recent failed for #{tag}: {e}")
            api_error = str(e)
            try:
                medias = self.cl.hashtag_medias_top(tag, amount=limit)
            except Exception as e2:
                logger.error(f"hashtag_medias_top failed for #{tag}: {e2}")
                api_error = str(e2)

        results = []
        for m in medias:
            parsed = self._parse_media_item(m)
            if parsed:
                results.append(parsed)

        logger.info(f"Retrieved {len(results)} posts for #{tag}")
        notice = None
        if len(results) == 0:
            notice = f"標籤 #{tag} 取得 0 則貼文。可能因 Instagram 官方限制公開 Hashtag API 或該標籤內容受限。建議使用「指定帳號 (get_user_medias)」或「動態探索 (get_timeline_feed)」進行精準瀏覽。"

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

    def get_post_context(self, media_pk: str, comment_limit: int = 10) -> Dict[str, Any]:
        """抓取特定貼文的完整上下文（內文、發布者、鄰近留言列表）"""
        logger.info(f"Fetching context for media PK: {media_pk}...")
        try:
            media = self.cl.media_info(media_pk)
        except Exception as e:
            logger.error(f"Failed to fetch media_info for {media_pk}: {e}")
            return {"error": f"Failed to get media info: {e}", "ok": False}

        comments_data = []
        try:
            raw_comments = self.cl.media_comments(media_pk, amount=comment_limit)
            for c in raw_comments:
                comments_data.append({
                    "pk": str(c.pk),
                    "text": str(c.text or ""),
                    "user": {
                        "pk": str(getattr(c.user, "pk", "")),
                        "username": str(getattr(c.user, "username", "")),
                    } if hasattr(c, "user") and c.user else {},
                    "created_at_utc": c.created_at_utc.isoformat() if hasattr(c, "created_at_utc") and c.created_at_utc else "",
                })
        except Exception as e:
            logger.warning(f"Failed to fetch comments for {media_pk}: {e}")

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

        return {
            "ok": True,
            "media": parsed_media,
            "comments": comments_data,
        }

    def post_comment(
        self,
        media_pk: str,
        text: str,
        reply_to_comment_pk: Optional[str] = None,
        jitter_min: float = 3.0,
        jitter_max: float = 6.0,
    ) -> Dict[str, Any]:
        """在貼文下發布留言或作為巢狀子留言回覆"""
        self._apply_jitter(jitter_min, jitter_max)

        replied_id = int(reply_to_comment_pk) if reply_to_comment_pk and str(reply_to_comment_pk).isdigit() else None
        logger.info(f"Posting comment to media {media_pk} (reply_to={replied_id}): {text[:40]}...")

        try:
            cmt = self.cl.media_comment(
                media_id=media_pk,
                text=text,
                replied_to_comment_id=replied_id,
            )
            return {
                "ok": True,
                "comment_pk": str(cmt.pk),
                "text": cmt.text,
                "media_pk": str(media_pk),
                "reply_to": str(reply_to_comment_pk or ""),
                "status": "posted",
            }
        except Exception as e:
            logger.error(f"Failed to post comment to media {media_pk}: {e}")
            return {"ok": False, "error": str(e)}

    def get_unread_dms(self, limit: int = 10) -> List[Dict[str, Any]]:
        """讀取未讀或最近的私訊線程"""
        logger.info(f"Fetching direct threads (limit={limit})...")
        try:
            threads = self.cl.direct_threads(amount=limit, selected_filter="unread")
        except Exception as e:
            logger.warning(f"direct_threads(unread) failed: {e}, falling back to all threads...")
            try:
                threads = self.cl.direct_threads(amount=limit)
            except Exception as e2:
                logger.error(f"Failed to fetch direct threads: {e2}")
                return []

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
        jitter_min: float = 3.0,
        jitter_max: float = 6.0,
    ) -> Dict[str, Any]:
        """發送私訊到指定對話線程"""
        self._apply_jitter(jitter_min, jitter_max)

        logger.info(f"Sending DM to thread {thread_id}: {text[:40]}...")
        try:
            result = self.cl.direct_send(text=text, thread_ids=[thread_id])
            msg_id = getattr(result, "id", "") if hasattr(result, "id") else ""
            return {
                "ok": True,
                "thread_id": thread_id,
                "message_id": str(msg_id),
                "status": "sent",
            }
        except Exception as e:
            logger.error(f"Failed to send DM to thread {thread_id}: {e}")
            return {"ok": False, "error": str(e)}

    def get_timeline_feed(self, limit: int = 10) -> List[Dict[str, Any]]:
        """讀取時間軸動態牆 (Timeline Feed) 或探索貼文，支援動態滾動探索"""
        logger.info(f"Fetching timeline/explore feed (limit={limit})...")
        medias = []
        try:
            try:
                raw_items = self.cl.get_timeline_feed()
                if isinstance(raw_items, dict) and "feed_items" in raw_items:
                    for item in raw_items.get("feed_items", []):
                        m = item.get("media_or_ad")
                        if m and not item.get("is_ad"):
                            medias.append(m)
                            if len(medias) >= limit:
                                break
            except Exception as e:
                logger.warning(f"get_timeline_feed fallback: {e}")

            if not medias:
                try:
                    explore_posts = self.cl.explore_reels(amount=max(1, limit))
                    return [self._parse_media_item(m) for m in explore_posts if self._parse_media_item(m)]
                except Exception as ex:
                    logger.error(f"explore_reels fallback failed: {ex}")
                    return []

            results = []
            for m in medias:
                parsed = self._parse_media_item(m)
                if parsed:
                    results.append(parsed)
            return results
        except Exception as e:
            logger.error(f"Failed to fetch timeline feed: {e}")
            return []

    def like_media(self, media_pk: str) -> Dict[str, Any]:
        """對指定貼文點讚"""
        self._apply_jitter(1.5, 3.0)
        try:
            ok = self.cl.media_like(media_pk)
            return {"ok": bool(ok), "media_pk": media_pk, "status": "liked"}
        except Exception as e:
            logger.error(f"Failed to like media {media_pk}: {e}")
            return {"ok": False, "error": str(e), "media_pk": media_pk}
