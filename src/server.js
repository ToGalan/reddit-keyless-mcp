#!/usr/bin/env node
// MCP server: read-only Reddit search, subreddit listings and threads over public RSS. No keys.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from './reddit.js';

const reddit = createClient();

const server = new McpServer({ name: 'reddit-keyless', version: '0.1.0' });

const time = z.enum(['hour', 'day', 'week', 'month', 'year', 'all']);
const limit = z.number().int().min(1).max(100);

function reply(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function failure(error) {
  return { isError: true, content: [{ type: 'text', text: error.message }] };
}

const SLOW = 'Reddit rate-limits its RSS feeds hard: calls are queued and spaced out, and can take a minute or more each. Call tools one at a time.';

server.registerTool(
  'search_reddit',
  {
    title: 'Search Reddit',
    description: `Search Reddit posts by keyword, across Reddit or inside one subreddit (prefer one subreddit: site-wide search is rate-limited more often, and Reddit's matching is loose, so expect off-topic results). Returns title, URL, subreddit, author, date and text for each post. ${SLOW}`,
    inputSchema: {
      query: z.string().min(1).describe('Search words, e.g. "linkedin recruiter scam"'),
      subreddit: z.string().optional().describe('Restrict to one subreddit, without r/ (e.g. "Scams")'),
      time: time.default('week').describe('How far back to search'),
      sort: z.enum(['relevance', 'new', 'hot', 'top', 'comments']).default('relevance'),
      limit: limit.default(25).describe('Maximum posts to return (Reddit sends at most 25 per feed)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return reply(await reddit.search(args));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'browse_subreddit',
  {
    title: 'Browse a subreddit',
    description: `List the latest (or hot, top, rising) posts in a subreddit, with title, URL, author, date and text. ${SLOW}`,
    inputSchema: {
      subreddit: z.string().min(2).describe('Subreddit name without r/, e.g. "recruitinghell"'),
      sort: z.enum(['new', 'hot', 'top', 'rising']).default('new'),
      time: time.default('week').describe('Time window, used with sort "top"'),
      limit: limit.default(25),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return reply(await reddit.browse(args));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'get_thread',
  {
    title: 'Read a Reddit thread',
    description: `Read a post and its comments from a Reddit thread URL (www, old or new reddit). Comments come as a flat list in Reddit's order, with author, date and text; reply nesting and scores are not available over RSS. ${SLOW}`,
    inputSchema: {
      url: z.string().describe('Thread URL, e.g. https://www.reddit.com/r/Scams/comments/abc123/title/'),
      comment_limit: limit.default(50).describe('Maximum comments to return'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, comment_limit }) => {
    try {
      return reply(await reddit.thread({ url, commentLimit: comment_limit }));
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
