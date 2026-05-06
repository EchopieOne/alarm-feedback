# alarm one - feedback

Cloudflare Worker + React 单页后台，用于从飞书多维表格处理未回复 feedback，生成 AI 邮件草稿，发送 Zeabur Email，并把最终邮件回写飞书。

## Local setup

Use Node 22.12 or newer. This repo includes `.nvmrc`.

1. Install dependencies:

```bash
nvm use
npm install
```

2. Create `.env.local` from `.env.example`.

3. Start local development. This runs the Cloudflare Worker and serves the React app from the same origin, so `/api/*` routes are available locally:

```bash
npm run dev
```

## Required Worker secrets

Set these with `wrangler secret put <NAME>` for production:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `FEISHU_APP_TOKEN_1`
- `FEISHU_TABLE_ID_1`
- `FEISHU_SOURCE_NAME_1`
- `FEISHU_APP_TOKEN_2`
- `FEISHU_TABLE_ID_2`
- `FEISHU_SOURCE_NAME_2`
- `REDIS_URL`
- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `ZEABUR_EMAIL_API_KEY`
- `MAIL_FROM`

## Deploy to Cloudflare Worker

1. Install dependencies and use the pinned Node.js version:

```bash
nvm use
npm install
```

2. Log in to Cloudflare:

```bash
npx wrangler login
```

3. Confirm the Worker name and assets binding in `wrangler.toml`. The current config deploys `src/worker/index.ts` as the Worker and serves the React build from `dist/client`.

4. Add production secrets. Run one command per secret listed above:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FEISHU_APP_TOKEN_1
npx wrangler secret put FEISHU_TABLE_ID_1
npx wrangler secret put FEISHU_SOURCE_NAME_1
npx wrangler secret put FEISHU_APP_TOKEN_2
npx wrangler secret put FEISHU_TABLE_ID_2
npx wrangler secret put FEISHU_SOURCE_NAME_2
npx wrangler secret put REDIS_URL
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put ZEABUR_EMAIL_API_KEY
npx wrangler secret put MAIL_FROM
```

5. Make sure Redis already contains a valid Feishu tenant token:

```bash
FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx REDIS_URL=redis://... node scripts/refresh-feishu-token.mjs
```

6. Build and deploy:

```bash
npm run deploy
```

7. Verify the deployed Worker URL. Open the URL printed by Wrangler, log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, and load cases. If Feishu writeback fails with `Forbidden`, confirm the Feishu app is added to the target Bitable as a document app/collaborator with edit access, then refresh `feishu:tenant_access_token`.

## GitHub Actions secrets

The scheduled token refresh workflow needs:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `REDIS_URL`

It writes `feishu:tenant_access_token` to Redis. The Worker only reads this key and never generates the token itself.

## Feishu sources

Configure two Bitable sources with `FEISHU_APP_TOKEN_1` / `FEISHU_TABLE_ID_1` and `FEISHU_APP_TOKEN_2` / `FEISHU_TABLE_ID_2`. Source 1 is treated as 国内用户 and source 2 is treated as 国外用户 by default. `FEISHU_SOURCE_NAME_1` and `FEISHU_SOURCE_NAME_2` can override the display names shown in the case list.

The older `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` pair is still accepted as source 1 for compatibility, but new deployments should use the numbered variables.

For writeback, the Feishu app must have Bitable record write permission and must also be added to the target Bitable as a document app/collaborator with edit access. After changing app permissions, refresh `feishu:tenant_access_token` in Redis.
