# reddit-keyless-mcp

A read-only Reddit MCP server that needs **no Reddit account, app or API key**. It searches
Reddit, lists a subreddit's posts and reads whole threads through Reddit's public RSS feeds, so
it works for anyone, today.

## Why it exists

Reddit's Responsible Builder Policy (November 2025) put new Data API apps behind manual review,
so `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are no longer something you can create for
yourself, and the anonymous `.json` endpoints now answer 403. Reddit MCP servers built on the API
or `.json` stop working without approved credentials. 

## What it can do

| Tool | What it does |
|---|---|
| `search_reddit` | Search posts by keyword across Reddit or inside one subreddit; filter by time (hour to all) and sort (relevance, new, hot, top, comments) |
| `browse_subreddit` | List a subreddit's new, hot, top or rising posts |
| `get_thread` | Read a post and its comments from any www, old or new reddit thread URL |

Every result has the title, URL, subreddit, author, date and plain text (HTML and Reddit's footer
stripped). All tools are read-only: nothing here can post, comment, vote or message.

## What it can't do

RSS is not the API, so some things are out of reach:

- **No scores or comment counts**, and comments come as a flat list without reply nesting.
- **At most 25 items per feed** (one page; no pagination).
- **No user profiles**, private subreddits or quarantined content.
- **Slow.** Reddit rate-limits RSS per IP address, roughly one feed a minute in practice. The
  server queues every call, spaces requests 6 seconds apart and backs off on HTTP 429 for up to
  2.5 minutes before giving up with a clear message. Ask for one thing at a time.
- **Loose search.** Reddit's search matches broadly; inside a busy subreddit most results can be
  off-topic. Restricting to a subreddit helps and is rate-limited less often than site-wide
  search.

## Install

Requires Node.js 18 or later.

**Claude Code**

```bash
claude mcp add reddit -- npx -y reddit-keyless-mcp
```

**Claude Desktop and other MCP clients** (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "reddit": {
      "command": "npx",
      "args": ["-y", "reddit-keyless-mcp"]
    }
  }
}
```

To run the latest code from GitHub instead of the npm release, use
`npx -y github:ToGalan/reddit-keyless-mcp`.

Calls can take more than a minute when Reddit is rate-limiting. If your client times out tool
calls sooner, raise its timeout (in Claude Code, `MCP_TOOL_TIMEOUT=300000`).

**Certificate errors** (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`): your
network inspects HTTPS. Pass your CA to the server with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`, or
on recent Node versions `NODE_USE_SYSTEM_CA=1`, in the server's `env`. Some MCP clients start servers with
a minimal environment, so set these in the server config rather than your shell.

## Settings

All optional, as environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `REDDIT_USER_AGENT` | `reddit-keyless-mcp/0.1 (...)` | User-Agent sent to Reddit; set one that identifies you |
| `REDDIT_MIN_GAP_MS` | `6000` | Minimum gap between requests |
| `REDDIT_MAX_WAIT_MS` | `150000` | How long to keep retrying a rate-limited request |

## Example

> Search r/Scams for "linkedin recruiter" from the past month, then read the most recent thread.

```json
{
  "url": "https://www.reddit.com/r/Scams/search.rss?q=linkedin+recruiter&t=month&sort=relevance&restrict_sr=1",
  "results": [
    {
      "id": "t3_…",
      "title": "Recruiter scam: pay for resume update",
      "url": "https://www.reddit.com/r/Scams/comments/…/",
      "subreddit": "Scams",
      "author": "…",
      "published": "2026-09-27T…",
      "text": "…"
    }
  ]
}
```

## Use responsibly

Reddit content belongs to its authors and Reddit's terms apply. Reading threads for your own
research is fine; don't store Reddit content in bulk, resell it or train models on it, and don't
use what you find to spam people. If you reply to someone you found this way, do it in public,
say who you are, and don't send unsolicited private messages.

## Development

```bash
npm install
npm test        # mocked feeds, no network
npm start       # runs the server on stdio
```

## License

MIT
