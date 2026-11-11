# Coworking Hub

A minimal, black-and-white HTML/CSS/JS coworking hub for friends, backed by **Cloudflare Workers + D1** and the **Are.na API**.

## Features
- **Accounts & Custom Name Styling**: Email, username, and password sign-up. Instead of profile pictures, everyone picks a **color** and **custom font** used to render their name across chat, resource folders, dropped blocks, and calendar calls.
- **Ongoing Group Chat**: Live-updating homepage group chat.
- **Are.na Resource Channels (Folders & Blocks)**: Click `+` to create a folder (creates an Are.na channel) and drag-and-drop or paste **anything** (files, images, PDFs, links, or text notes) as blocks.
- **Call Calendar + Highlighted Next Call**: Month grid and call list for scheduling FaceTime/external calls, with RSVPs and the **next upcoming (or live) call highlighted at the top** on both desktop and mobile.
- **Desktop & Mobile Layouts**:
  - **Desktop**: Left sidebar for resource channels, main area split into Chat and Calendar.
  - **Mobile**: Primarily Chat, with a top menu selector to switch to Resources or Calendar.

---

## 1. Try It Locally Right Away (Zero Install)

Because `dev-server.js` uses Node's built-in `node:sqlite`, you can run the full stack locally right now:

```bash
npm start
```

Then open **http://localhost:8787**.

---

## 2. Attach Your Are.na API Token

1. Log in to [Are.na](https://www.are.na) and open **[dev.are.na/oauth/applications](https://dev.are.na/oauth/applications)** (or Account Settings -> Applications).
2. Click **New Application** (give it any name, e.g. `Coworking`, and callback URL `http://localhost:8787`).
3. Copy the **Personal Access Token** shown on your application page.
4. **For local testing**:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   Paste your token into `.dev.vars`:
   ```ini
   ARENA_ACCESS_TOKEN=your_arena_personal_access_token_here
   ARENA_CHANNEL_STATUS=closed
   ```
   *(Note: `"closed"` creates channels that don't count against Are.na's free-tier private channel limit while ensuring only your hub/account can add blocks. Change to `"private"` if you have Are.na Premium and want private channels, or `"public"` for open channels.)*

---

## 3. Deploy to Cloudflare (Workers + Static Assets + D1)

1. **Authenticate Wrangler with your Cloudflare account**:
   ```bash
   npx wrangler login
   ```

2. **Create your Cloudflare D1 database**:
   ```bash
   npx wrangler d1 create coworking-db
   ```
   Wrangler will print a `database_id` UUID (e.g. `a1b2c3d4-...`). Copy that UUID and paste it into `wrangler.toml` replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "coworking-db"
   database_id = "YOUR_UUID_HERE"
   ```

3. **Initialize the D1 database schema**:
   ```bash
   npm run db:init:remote
   ```

4. **Upload your Are.na API token as an encrypted Cloudflare Secret**:
   ```bash
   npx wrangler secret put ARENA_ACCESS_TOKEN
   ```
   *(Paste your Are.na Personal Access Token when prompted.)*

   *(Optional)* If you want to require a shared password so only your friends can sign up on your public URL:
   ```bash
   npx wrangler secret put SIGNUP_PASSCODE
   ```

5. **Deploy**:
   ```bash
   npm run deploy
   ```
   Cloudflare will output your live URL (e.g. `https://coworking-hub.<your-subdomain>.workers.dev`), or you can attach a custom domain in the Cloudflare Dashboard under **Workers & Pages -> coworking-hub -> Settings -> Domains & Routes**.
