/**
 * src/types.ts —— 型別定義 (支援 Reel 短影音、影片、聯名標記與純瀏覽)
 */

export interface InstagramPost {
  pk: string
  id: string
  code: string
  caption: string
  like_count: number
  comment_count: number
  view_count?: number
  media_type?: number
  product_type?: string
  type_label?: string
  is_video?: boolean
  is_reel?: boolean
  is_carousel?: boolean
  thumbnail_url?: string
  video_url?: string
  user: {
    pk: string
    username: string
    full_name: string
    is_verified?: boolean
  }
  is_collaborative?: boolean
  coauthors?: string[]
  url: string
  taken_at: string
}

export interface InstagramComment {
  pk: string
  text: string
  user: {
    pk: string
    username: string
  }
  created_at_utc: string
}

export interface InstagramPostContext {
  ok: boolean
  media?: InstagramPost
  comments?: InstagramComment[]
  error?: string
}

export interface InstagramDmThread {
  thread_id: string
  title: string
  users: Array<{ pk: string; username: string; full_name: string }>
  unread: boolean
  last_message?: {
    id: string
    user_id: string
    text: string
    timestamp: string
    is_outgoing: boolean
  }
}

export interface InstagramLoginResult {
  ok: boolean
  method?: 'session' | 'password' | 'already_logged_in' | 'credentials'
  username?: string
  user_id?: string
  message: string
  error?: string
  challenge_required?: boolean
  two_factor_required?: boolean
}

export interface InstagramUserMeta {
  pk: string
  username: string
  full_name: string
  biography?: string
  media_count?: number
  follower_count?: number
  following_count?: number
  is_private?: boolean
  is_verified?: boolean
  profile_pic_url?: string
}

export interface InstagramUserMediasResult {
  ok: boolean
  user?: InstagramUserMeta
  count?: number
  posts: InstagramPost[]
  message?: string
  error?: string
  username?: string
}

export interface InstagramUserClipsResult {
  ok: boolean
  username?: string
  count?: number
  reels: InstagramPost[]
  error?: string
}

export interface InstagramSearchUsersResult {
  ok: boolean
  query: string
  users: Array<{
    pk: string
    username: string
    full_name: string
    is_private: boolean
    is_verified: boolean
    profile_pic_url: string
  }>
}

export interface InstagramSearchTagsResult {
  ok: boolean
  query: string
  tags: Array<{
    name: string
    media_count: number
  }>
}

export interface InstagramAntiRiskStatus {
  in_cooldown: boolean
  cooldown_remaining_sec: number
  cooldown_reason: string
  hourly_write_count: number
  hourly_write_cap: number
  last_write_timestamp: number
}

