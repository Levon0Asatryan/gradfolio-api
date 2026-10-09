/**
 * Video attachments are links to a few known hosts. The page embeds
 * `embedUrl` only, never the user's own link, and the host is matched on the
 * *parsed* hostname: `youtube.com.evil.example`, `evil.example/youtube.com` and
 * `youtube.com@evil.example` are other hosts.
 */
export interface VideoInfo {
  embedUrl: string;
  thumbnailUrl: string | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export function parseVideo(url: string, allowedHosts: readonly string[]): VideoInfo | null {
  const u = URL.parse(url);
  if (u?.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) return null;
  const parts = u.pathname.split('/').filter((p) => p.length > 0);

  let youtube: string | undefined;
  if (host === 'youtu.be') youtube = parts[0];
  else if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === 'watch') youtube = u.searchParams.get('v') ?? undefined;
    else if (parts[0] === 'embed' || parts[0] === 'shorts') youtube = parts[1];
  }
  if (youtube !== undefined) {
    if (!YOUTUBE_ID.test(youtube)) return null;
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}`,
      thumbnailUrl: `https://img.youtube.com/vi/${youtube}/hqdefault.jpg`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = host === 'vimeo.com' ? parts[0] : parts[0] === 'video' ? parts[1] : undefined;
    if (id !== undefined && VIMEO_ID.test(id)) {
      return { embedUrl: `https://player.vimeo.com/video/${id}`, thumbnailUrl: null };
    }
  }
  return null;
}
