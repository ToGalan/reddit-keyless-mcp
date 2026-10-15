// Read-only Reddit access through Reddit's public RSS (Atom) feeds. No account, app or key.
//
// Since Reddit's Responsible Builder Policy (November 2025) new API apps need Reddit's manual
// approval, and the anonymous .json endpoints answer 403. The RSS feeds still answer, but are
// rate-limited hard (roughly one feed a minute in practice), so every request goes through one
// throttle that spaces requests out and backs off on 429.

const BASE = 'https://www.reddit.com';
const DEFAULT_USER_AGENT = 'reddit-keyless-mcp/0.1 (read-only RSS; +https://github.com/ToGalan/reddit-keyless-mcp)';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = hex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// Entry content is HTML escaped inside the XML: decode, drop tags and Reddit's "submitted by" footer.
export function htmlToText(escaped) {
  const html = decodeEntities(escaped)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(html)
    .replace(/\s*submitted by\s+\/u\/\S+[\s\S]*$/i, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? match[1].trim() : '';
}

export function parseAtom(xml) {
  const entries = [];
  for (const [, body] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const link = body.match(/<link[^>]*href="([^"]+)"/);
    const category = body.match(/<category[^>]*term="([^"]+)"/);
    entries.push({
      id: tag(body, 'id'),
      title: decodeEntities(tag(body, 'title')),
      url: link ? decodeEntities(link[1]) : '',
      subreddit: category ? category[1] : '',
      author: tag(tag(body, 'author'), 'name').replace(/^\/u\//, ''),
      published: tag(body, 'published') || tag(body, 'updated'),
      text: htmlToText(tag(body, 'content')),
    });
  }
  return entries;
}

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
const TIMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
const SEARCH_SORTS = new Set(['relevance', 'new', 'hot', 'top', 'comments']);
const LISTING_SORTS = new Set(['new', 'hot', 'top', 'rising']);

function checkSubreddit(name) {
  const clean = String(name ?? '').replace(/^\/?r\//i, '');
  if (!SUBREDDIT.test(clean)) throw new Error(`Not a subreddit name: ${name}`);
  return clean;
}

export function searchUrl({ query, subreddit, time = 'week', sort = 'relevance' }) {
  if (!query || !String(query).trim()) throw new Error('query is required');
  if (!TIMES.has(time)) throw new Error(`time must be one of ${[...TIMES].join(', ')}`);
  if (!SEARCH_SORTS.has(sort)) throw new Error(`sort must be one of ${[...SEARCH_SORTS].join(', ')}`);
  const params = new URLSearchParams({ q: String(query).trim(), t: time, sort });
  if (subreddit) {
    params.set('restrict_sr', '1');
    return `${BASE}/r/${checkSubreddit(subreddit)}/search.rss?${params}`;
  }
  return `${BASE}/search.rss?${params}`;
}

export function listingUrl({ subreddit, sort = 'new', time = 'week' }) {
  if (!LISTING_SORTS.has(sort)) throw new Error(`sort must be one of ${[...LISTING_SORTS].join(', ')}`);
  const base = `${BASE}/r/${checkSubreddit(subreddit)}/${sort}/.rss`;
  return sort === 'top' ? `${base}?t=${TIMES.has(time) ? time : 'week'}` : base;
}

export function threadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url, BASE);
  } catch {
    throw new Error(`Not a Reddit thread URL: ${url}`);
  }
  const host = parsed.hostname.replace(/^(www|old|new|np)\./, '');
  if (host !== 'reddit.com' || !/^\/r\/[^/]+\/comments\/[a-z0-9]+/i.test(parsed.pathname)) {
    throw new Error(`Not a Reddit thread URL: ${url}`);
  }
  return `${BASE}${parsed.pathname.replace(/\/?$/, '/')}.rss`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One client per process: requests are serialised and spaced out, because Reddit's RSS limit is
 * per IP address. Calls queue behind each other rather than running in parallel.
 */
export function createClient({
  fetch: fetchImpl = globalThis.fetch,
  userAgent = process.env.REDDIT_USER_AGENT || DEFAULT_USER_AGENT,
  minGapMs = Number(process.env.REDDIT_MIN_GAP_MS) || 6000,
  maxWaitMs = Number(process.env.REDDIT_MAX_WAIT_MS) || 150000,
  wait = sleep,
  now = Date.now,
} = {}) {
  let queue = Promise.resolve();
  let last = 0;

  async function fetchOnce(url) {
    const started = now();
    for (let attempt = 1; ; attempt += 1) {
      const gap = last + minGapMs - now();
      if (gap > 0) await wait(gap);
      last = now();
      let response;
      try {
        response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/atom+xml' } });
      } catch (error) {
        // Network failure (reset, DNS, timeout): retry like a rate limit, then report it plainly.
        response = { ok: false, status: 0, networkError: error.cause?.code || error.message };
      }
      if (response.ok) return response.text();
      if (response.status === 0 && now() - started + 5000 * attempt > maxWaitMs) {
        throw new Error(`Could not reach Reddit (${response.networkError}). Check the internet connection and try again.`);
      }
      if (response.status === 404) throw new Error('Reddit says this does not exist (404). Check the subreddit or thread URL.');
      if (response.status === 403) throw new Error('Reddit refused the request (403). The subreddit may be private, banned or quarantined.');
      if (response.status !== 0 && response.status !== 429 && response.status < 500) {
        throw new Error(`Reddit answered ${response.status}.`);
      }
      const backoff = Math.min(60000, 5000 * attempt);
      if (now() - started + backoff > maxWaitMs) {
        throw new Error('Reddit is rate-limiting this IP address. Wait a few minutes and try again, and run searches one at a time.');
      }
      await wait(backoff);
    }
  }

  function feed(url) {
    const run = queue.then(() => fetchOnce(url));
    queue = run.catch(() => {});
    return run.then(parseAtom);
  }

  return {
    async search({ query, subreddit, time, sort, limit = 25 }) {
      const url = searchUrl({ query, subreddit, time, sort });
      return { url, results: (await feed(url)).slice(0, limit) };
    },
    async browse({ subreddit, sort, time, limit = 25 }) {
      const url = listingUrl({ subreddit, sort, time });
      return { url, results: (await feed(url)).slice(0, limit) };
    },
    async thread({ url, commentLimit = 50 }) {
      const entries = await feed(threadUrl(url));
      return { url, post: entries[0] ?? null, comments: entries.slice(1, 1 + commentLimit) };
    },
  };
}
