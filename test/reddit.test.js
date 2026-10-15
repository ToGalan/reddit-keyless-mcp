import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, listingUrl, parseAtom, searchUrl, threadUrl } from '../src/reddit.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Recruiter on LinkedIn wants me to pay for training</title>
<entry>
<author><name>/u/asker</name><uri>https://www.reddit.com/user/asker</uri></author>
<category term="Scams" label="r/Scams"/>
<content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;They asked for &amp;quot;a &amp;#36;200 fee&amp;quot; first.&lt;/p&gt;&lt;p&gt;Is this legit?&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/asker&quot;&gt; /u/asker &lt;/a&gt;</content>
<id>t3_abc123</id>
<link href="https://www.reddit.com/r/Scams/comments/abc123/recruiter_on_linkedin/" />
<updated>2026-10-10T09:00:00+00:00</updated>
<published>2026-10-10T09:00:00+00:00</published>
<title>Recruiter on LinkedIn wants me to pay for training</title>
</entry>
<entry>
<author><name>/u/helper</name></author>
<category term="Scams" label="r/Scams"/>
<content type="html">&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Real employers don&amp;#39;t charge you.&lt;/p&gt;&lt;/div&gt;</content>
<id>t1_def456</id>
<link href="https://www.reddit.com/r/Scams/comments/abc123/recruiter_on_linkedin/def456/" />
<updated>2026-10-10T10:00:00+00:00</updated>
<title>/u/helper on Recruiter on LinkedIn wants me to pay for training</title>
</entry>
</feed>`;

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const next = responses.shift();
    return { ok: next.status === 200, status: next.status, text: async () => next.body ?? '' };
  };
  return { fetch, calls };
}

function fakeClock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
}

test('parses Atom entries into plain text without the feed title or footer', () => {
  const [post, comment] = parseAtom(FEED);
  assert.deepEqual(post, {
    id: 't3_abc123',
    title: 'Recruiter on LinkedIn wants me to pay for training',
    url: 'https://www.reddit.com/r/Scams/comments/abc123/recruiter_on_linkedin/',
    subreddit: 'Scams',
    author: 'asker',
    published: '2026-10-10T09:00:00+00:00',
    text: 'They asked for "a $200 fee" first.\nIs this legit?',
  });
  assert.equal(comment.text, "Real employers don't charge you.");
  assert.equal(comment.published, '2026-10-10T10:00:00+00:00');
});

test('builds feed URLs and rejects bad input', () => {
  assert.equal(
    searchUrl({ query: 'linkedin recruiter', subreddit: 'r/Scams', time: 'month' }),
    'https://www.reddit.com/r/Scams/search.rss?q=linkedin+recruiter&t=month&sort=relevance&restrict_sr=1',
  );
  assert.equal(searchUrl({ query: 'ghost job' }), 'https://www.reddit.com/search.rss?q=ghost+job&t=week&sort=relevance');
  assert.equal(listingUrl({ subreddit: 'recruitinghell' }), 'https://www.reddit.com/r/recruitinghell/new/.rss');
  assert.equal(listingUrl({ subreddit: 'jobs', sort: 'top', time: 'month' }), 'https://www.reddit.com/r/jobs/top/.rss?t=month');
  assert.equal(
    threadUrl('https://old.reddit.com/r/Scams/comments/abc123/x?utm=1'),
    'https://www.reddit.com/r/Scams/comments/abc123/x/.rss',
  );
  assert.throws(() => threadUrl('https://example.com/r/Scams/comments/abc'), /Not a Reddit thread/);
  assert.throws(() => threadUrl('https://evilreddit.com/r/Scams/comments/abc'), /Not a Reddit thread/);
  assert.throws(() => listingUrl({ subreddit: '../../etc' }), /Not a subreddit/);
  assert.throws(() => searchUrl({ query: ' ' }), /query is required/);
});

test('thread splits the post from its comments and honours the limit', async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: FEED }]);
  const client = createClient({ fetch, ...fakeClock() });
  const out = await client.thread({ url: 'https://www.reddit.com/r/Scams/comments/abc123/recruiter_on_linkedin/', commentLimit: 1 });
  assert.equal(calls[0], 'https://www.reddit.com/r/Scams/comments/abc123/recruiter_on_linkedin/.rss');
  assert.equal(out.post.id, 't3_abc123');
  assert.equal(out.comments.length, 1);
});

test('backs off on 429, spaces requests, and gives up with a clear message', async () => {
  const clock = fakeClock();
  const { fetch, calls } = fakeFetch([{ status: 429 }, { status: 200, body: FEED }, { status: 200, body: FEED }]);
  const client = createClient({ fetch, minGapMs: 6000, ...clock });
  const first = await client.search({ query: 'x', subreddit: 'Scams' });
  assert.equal(first.results.length, 2);
  const before = clock.now();
  await client.browse({ subreddit: 'Scams' });
  assert.ok(clock.now() - before >= 6000, 'second request waited for the gap');
  assert.equal(calls.length, 3);

  const limited = createClient({ fetch: fakeFetch(Array(20).fill({ status: 429 })).fetch, maxWaitMs: 20000, ...fakeClock() });
  await assert.rejects(limited.browse({ subreddit: 'Scams' }), /rate-limiting/);
});

test('retries network failures, then reports them plainly', async () => {
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    return { ok: true, status: 200, text: async () => FEED };
  };
  const client = createClient({ fetch: flaky, ...fakeClock() });
  assert.equal((await client.browse({ subreddit: 'Scams' })).results.length, 2);

  const down = async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); };
  const offline = createClient({ fetch: down, maxWaitMs: 20000, ...fakeClock() });
  await assert.rejects(offline.browse({ subreddit: 'Scams' }), /Could not reach Reddit \(ENOTFOUND\)/);
});

test('explains 403 and 404', async () => {
  const client = createClient({ fetch: fakeFetch([{ status: 403 }, { status: 404 }]).fetch, ...fakeClock() });
  await assert.rejects(client.browse({ subreddit: 'private_sub' }), /403/);
  await assert.rejects(client.browse({ subreddit: 'missing_sub' }), /404/);
});
