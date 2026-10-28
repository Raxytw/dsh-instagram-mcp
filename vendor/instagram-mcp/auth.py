import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any

from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    TwoFactorRequired,
    ChallengeRequired,
    LoginRequired,
    PleaseWaitFewMinutes,
)

logger = logging.getLogger("instagram_mcp.auth")


class InstagramAuth:
    """Instagram 登入認證與 Session 狀態維護類別"""

    def __init__(self, client: Optional[Client] = None):
        self.cl = client or Client()
        # 防風控設定：配置請求內建隨機等待區間與裝置語系，降低被 Instagram 風控標記為異常腳本的機率
        try:
            self.cl.delay_range = [3, 6]
            self.cl.set_country("TW")
            self.cl.set_locale("zh_TW")
        except Exception:
            pass

    def set_proxy(self, proxy_url: Optional[str] = None):
        """配置代理伺服器 (http/https/socks5)"""
        if proxy_url and proxy_url.strip():
            proxy = proxy_url.strip()
            self.cl.set_proxy(proxy)
            logger.info("Proxy configured successfully")

    def test_session_validity(self) -> bool:
        """測試目前 Session 是否仍然有效"""
        try:
            # 嘗試獲取自身帳號資訊以測試憑證有效性
            if not self.cl.user_id:
                return False
            self.cl.get_timeline_feed()
            return True
        except Exception as e:
            logger.warning(f"Session validity check failed: {e}")
            return False

    def load_session(self, session_path: str) -> bool:
        """從指定路徑載入持久化的 Session"""
        path = Path(session_path)
        if not path.exists() or path.stat().st_size == 0:
            return False

        try:
            with open(path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            if isinstance(settings, dict) and settings:
                self.cl.set_settings(settings)
                return True
        except Exception as e:
            logger.error(f"Failed to load session settings from {session_path}: {e}")
        return False

    def save_session(self, session_path: str) -> bool:
        """以原子操作方式將 Session 保存至磁碟，避免寫入中斷損毀"""
        try:
            target_path = Path(session_path)
            target_path.parent.mkdir(parents=True, exist_ok=True)

            settings = self.cl.get_settings()
            # 寫入暫存檔再替換
            temp_file = target_path.with_suffix(".tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, target_path)
            logger.info(f"Session saved successfully to {session_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save session to {session_path}: {e}")
            return False

    def login(
        self,
        username: str,
        password: str = "",
        session_path: str = "data/ig_session.json",
        two_factor_code: str = "",
        proxy_url: str = "",
    ) -> Dict[str, Any]:
        """
        執行登入流程：優先使用現有 Session，失效或不存在時走帳密與 2FA 流程
        """
        self.set_proxy(proxy_url)

        # 1. 嘗試從 Session 載入
        if self.load_session(session_path):
            logger.info("Loaded session settings, testing validity...")
            if self.test_session_validity():
                logger.info("Session is valid. Logged in via session cache.")
                actual_username = getattr(self.cl, "username", "") or ""
                if not actual_username and self.cl.user_id:
                    try:
                        actual_username = self.cl.username_from_user_id(self.cl.user_id)
                    except Exception as err:
                        logger.warning(f"Could not resolve username from user_id: {err}")
                return {
                    "ok": True,
                    "method": "session",
                    "user_id": str(self.cl.user_id),
                    "username": actual_username or username,
                    "message": "Session is valid",
                }
            else:
                logger.warning("Session expired or invalid, proceeding to credentials login.")

        # 2. 若無帳密且 Session 失效，回傳需登入
        if not username or not password:
            return {
                "ok": False,
                "error": "LOGIN_REQUIRED",
                "message": "Session expired or missing, and username/password not provided",
            }

        # 3. 嘗試使用帳號密碼與 2FA 驗證碼登入
        try:
            logger.info(f"Logging in user: {username}")
            verification_code = two_factor_code.strip() if two_factor_code else None
            logged_in = self.cl.login(
                username=username,
                password=password,
                verification_code=verification_code,
            )
            if logged_in:
                self.save_session(session_path)
                actual_username = getattr(self.cl, "username", "") or ""
                if not actual_username and self.cl.user_id:
                    try:
                        actual_username = self.cl.username_from_user_id(self.cl.user_id)
                    except Exception:
                        pass
                return {
                    "ok": True,
                    "method": "credentials",
                    "user_id": str(self.cl.user_id),
                    "username": actual_username or username,
                    "message": "Login successful",
                }
            else:
                return {
                    "ok": False,
                    "error": "LOGIN_FAILED",
                    "message": "Login returned False without exception",
                }

        except TwoFactorRequired as e:
            logger.warning(f"Two factor authentication required: {e}")
            return {
                "ok": False,
                "error": "TWO_FACTOR_REQUIRED",
                "message": "Two factor authentication (2FA) is required. Please provide twoFactorCode.",
            }
        except ChallengeRequired as e:
            logger.warning(f"Challenge checkpoint encountered: {e}")
            return {
                "ok": False,
                "error": "CHALLENGE_REQUIRED",
                "message": "Instagram challenge required (SMS/Email/In-App verification needed).",
            }
        except BadPassword:
            logger.error("Incorrect password")
            return {
                "ok": False,
                "error": "BAD_PASSWORD",
                "message": "Incorrect Instagram username or password",
            }
        except PleaseWaitFewMinutes:
            logger.error("Rate limited: Please wait a few minutes before trying again.")
            return {
                "ok": False,
                "error": "RATE_LIMITED",
                "message": "Instagram rate limited: Please wait a few minutes before retrying.",
            }
        except Exception as e:
            logger.error(f"Unexpected login exception: {e}")
            return {
                "ok": False,
                "error": "UNKNOWN_ERROR",
                "message": str(e),
            }
