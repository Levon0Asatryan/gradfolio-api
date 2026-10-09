import { describe, expect, it } from 'vitest';
import { parseVideo } from './video.js';

const HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
];
const ID = 'dQw4w9WgXcQ';
const YT = {
  embedUrl: `https://www.youtube-nocookie.com/embed/${ID}`,
  thumbnailUrl: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
};

describe('parseVideo', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
  ])('embeds YouTube link %s', (url) => {
    expect(parseVideo(url, HOSTS)).toEqual(YT);
  });

  it('embeds Vimeo links, both forms, without a thumbnail', () => {
    const expected = { embedUrl: 'https://player.vimeo.com/video/76979871', thumbnailUrl: null };
    expect(parseVideo('https://vimeo.com/76979871', HOSTS)).toEqual(expected);
    expect(parseVideo('https://player.vimeo.com/video/76979871', HOSTS)).toEqual(expected);
  });

  it.each([
    ['a lookalike host', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['the host in the path', `https://evil.example/youtube.com/watch?v=${ID}`],
    ['userinfo naming the host', `https://youtube.com@evil.example/watch?v=${ID}`],
    ['credentials on the real host', `https://u:p@www.youtube.com/watch?v=${ID}`],
    ['a punycode lookalike', `https://xn--yutube-ixa.com/watch?v=${ID}`],
    ['http', `http://www.youtube.com/watch?v=${ID}`],
    ['javascript:', `javascript:alert(1)//youtube.com/watch?v=${ID}`],
    ['a short id', 'https://youtu.be/abc'],
    ['an id with markup', 'https://youtu.be/"><script>a'],
    ['a channel page', 'https://www.youtube.com/@someone'],
    ['a non-numeric Vimeo id', 'https://vimeo.com/evil'],
    ['not a URL', 'youtube.com/watch?v=dQw4w9WgXcQ'],
  ])('refuses %s', (_name, url) => {
    expect(parseVideo(url, HOSTS)).toBeNull();
  });

  it('refuses a host that is not in the configured list, even a known one', () => {
    expect(parseVideo(`https://youtu.be/${ID}`, ['vimeo.com'])).toBeNull();
  });
});
