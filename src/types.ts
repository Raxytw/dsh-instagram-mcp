/**
 * src/types.ts —— 型別定義 (支援 Reel 短影音、影片、聯名標記與純瀏覽)
 */

export interface InstagramPost {
  pk: string
  id: string
  code: string
  title?: string
  caption: string
  accessibility_caption?: string
  audio_info?: string
  location_name?: string
  video_duration?: number
  video_subtitles?: string
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
  image_urls?: string[]
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
  parent_comment_pk?: string
  parent_comment_user?: string
  parent_comment_text?: string
}

export interface InstagramRecentMentionsResult {
  ok: boolean
  media_pks: string[]
  mentions: Array<{
    media_pk: string
    comment_pk?: string
    text?: string
    notif_name?: string
    story_type?: any
    timestamp?: string
  }>
  error?: string
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

export interface InstagramFuzzySearchResult {
  ok: boolean
  query: string
  count: number
  posts: InstagramPost[]
  sources?: string[]
  status?: string
  error?: string
}

export interface InstagramAntiRiskStatus {
  in_cooldown: boolean
  cooldown_remaining_sec: number
  cooldown_reason: string
  hourly_write_count: number
  hourly_write_cap: number
  last_write_timestamp: number
}

export interface InstagramRepostResult {
  ok: boolean
  repost_mode?: 'story' | 'feed' | 'dm' | string
  source_media_pk?: string
  source_url?: string
  source_author?: string
  repost_pk?: string
  repost_code?: string
  repost_url?: string
  thread_id?: string
  caption?: string
  mentioned_users?: string[]
  status?: string
  error?: string
  in_cooldown?: boolean
  cooldown_remaining_sec?: number
}

