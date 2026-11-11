# NEXUS-12

A starter autonomous software-engineering agent with:
- Cloudflare Pages dashboard (`public/`)
- Cloudflare Worker AI gateway (`worker/`)
- Local Node.js + Playwright runner (`runner/`)
- 12-hour maximum session per run
- Workspace-scoped file operations and a small command allowlist
- Browser navigation through Playwright

## Important architecture note

Cloudflare Pages/Workers host the dashboard and AI gateway. They do **not** host a persistent desktop browser. The local runner on your computer performs file edits and browser automation. Keep the computer awake and the runner process open for the session.

The runner checks the 12-hour limit itself. It does not pretend to run when your computer is off. It checkpoints the conversation to `.nexus-session.json`.

## Requirements

- Node.js 20 or newer
- An OpenAI API key (API usage may cost money; ChatGPT subscription does not include API credits)
- A Cloudflare account for deployment (the static dashboard can be hosted on Pages)
- Optional: GitHub repository for your project

## 1. Deploy the dashboard

1. Create a GitHub repository and upload the contents of this project.
2. In Cloudflare Dashboard, open **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select this repository.
4. Set **Build command** to blank / none.
5. Set **Build output directory** to `public`.
6. Deploy.

The dashboard is static and does not need a card for a normal free Pages deployment. Cloudflare plan limits can change; check the current official limits page linked below.

## 2. Deploy the AI gateway Worker

From the project root:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put NEXUS_ACCESS_TOKEN
npx wrangler deploy
```

When prompted for `NEXUS_ACCESS_TOKEN`, use a long random secret. Keep it private. The Worker URL will look like:

`https://nexus-12-api.<your-subdomain>.workers.dev`

Copy that URL. Do not put your OpenAI key in the browser or in `public/`.

## 3. Configure the local runner

In a terminal from the project root:

```bash
cd runner
npm install
npx playwright install chromium
```

Copy `.env.example` to `.env` and set:

```env
NEXUS_API_URL=https://nexus-12-api.<your-subdomain>.workers.dev
NEXUS_ACCESS_TOKEN=the_same_long_random_secret
NEXUS_WORKSPACE=./workspace
NEXUS_HEADLESS=false
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` with Notepad. The runner will create the workspace folder.

## 4. Start a mission

From `runner/`:

```bash
npm start -- "Build a responsive portfolio website with a contact form and README."
```

The browser opens visibly when `NEXUS_HEADLESS=false`. The agent can navigate pages you explicitly assign, read and write files inside its workspace, and run only the commands listed in `runner/src/safety.js`.

## Dashboard

Open the Cloudflare Pages URL. The dashboard can check the Worker connection and submit a mission prompt. The actual long-running local execution is started from your computer using the command above.

## Safety

- The runner is designed for a workspace directory only.
- Shell execution is allowlisted; arbitrary shell commands are not accepted.
- Browser navigation is limited to HTTP/HTTPS URLs.
- The agent must request approval for external side effects (payments, purchases, publishing, sending messages, deleting data, account/security changes).
- Do not use it to bypass CAPTCHAs, logins, access controls, or anti-bot measures.
- Never share `.env`, API keys, cookies, or session files.
- Review generated code before deploying it publicly.

## Useful official documentation

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages: https://developers.cloudflare.com/pages/
- Playwright: https://playwright.dev/docs/intro
