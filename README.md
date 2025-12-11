# Alphalert Telegram Wallet Scorer

Standalone wallet scoring script for Telegram bot integration. Zero dependencies - uses native `fetch`.

## Quick Start

```bash
# Test locally
node index.js <walletAddress> [chain]

# Example
node index.js Ez2jp3rwXUbaTx7XwiHGaWVgTPFdzJoSg8TopqbxfaJN sol
```

## Output Format

```
Scored Wallet: Ez2j...faJN
👑 KOL: Keano
🛠 Dev: 4578 tokens, 1 rugs

Score: -0.52 🟠 Poor
Tokens: 9 | Entries: 50
🔵 4 | 🟢 0 | 🟡 2 | 🟠 0 | 🔴 3

Realized PnL: +$70.4K
Unrealized PnL: $0
Rugged: 3/9 (33%)

Top Tokens
🔵 MINER: +$17.7K (1↗ | 21↘)
🔵 Researchoor: +$15.6K (8↗ | 16↘)
🔵 AIM: +$14.5K (4↗ | 14↘)
🔴 67: +$7.3K (23↗ | 62↘)
🟡 CHUOI: +$5.3K (8↗ | 17↘)
```

---

# 🚀 Deployment Guide

## Step 1: Create a New Git Repository

```bash
# Navigate to the telegram-scorer folder
cd telegram-scorer

# Initialize git
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Telegram wallet scorer"

# Create repo on GitHub (via web or gh cli)
# Then push:
git remote add origin https://github.com/YOUR_USERNAME/alphalert-telegram-scorer.git
git branch -M main
git push -u origin main
```

## Step 2: Create Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts:
   - Choose a name: `Alphalert Wallet Scorer`
   - Choose a username: `alphalert_scorer_bot` (must end in `bot`)
4. **Save the API token** - looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Configure Bot Settings (Optional)

```
/setcommands
```
Then send:
```
score - Score a wallet: /score <address> <chain>
```

## Step 3: Deploy to Vercel

### Option A: Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (from telegram-scorer folder)
vercel

# Follow prompts:
# - Link to existing project? No
# - Project name: alphalert-telegram-scorer
# - Directory: ./
# - Override settings? No

# Set environment variable
vercel env add TELEGRAM_BOT_TOKEN

# Paste your bot token when prompted

# Deploy to production
vercel --prod
```

### Option B: Via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..." → "Project"**
3. Import your GitHub repository
4. Click **"Deploy"**
5. After deployment, go to **Settings → Environment Variables**
6. Add:
   - Name: `TELEGRAM_BOT_TOKEN`
   - Value: `your_bot_token_here`
7. **Redeploy** for the env var to take effect

## Step 4: Set Telegram Webhook

Replace `YOUR_BOT_TOKEN` and `YOUR_VERCEL_URL`:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_VERCEL_URL.vercel.app/api/webhook"}'
```

Example:
```bash
curl -X POST "https://api.telegram.org/bot1234567890:ABCdef.../setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://alphalert-telegram-scorer.vercel.app/api/webhook"}'
```

### Verify Webhook

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

You should see:
```json
{
  "ok": true,
  "result": {
    "url": "https://your-app.vercel.app/api/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Step 5: Test Your Bot!

Open Telegram, find your bot, and send:

```
/score Ez2jp3rwXUbaTx7XwiHGaWVgTPFdzJoSg8TopqbxfaJN sol
```

---

# ❓ FAQ

## What happens if someone spams commands?

**Rate limiting is handled at multiple levels:**

1. **Telegram's built-in rate limits** - Telegram limits how fast bots can send messages (~30 msgs/sec globally)

2. **Vercel's concurrent execution** - On free tier, you get 10 concurrent executions. If exceeded, requests queue.

3. **OKX API rate limits** - The scorer adds 100ms delays between API calls to avoid hitting OKX limits.

**For heavy usage, consider:**
- Adding a Redis cache for recent wallet scores
- Implementing per-user cooldowns
- Upgrading Vercel plan for more concurrent executions

## What if many people call it at once?

**Vercel handles this automatically:**

| Plan | Concurrent Executions | Duration Limit |
|------|----------------------|----------------|
| Hobby (Free) | 10 | 10 seconds |
| Pro | 1000 | 60 seconds |
| Enterprise | Unlimited | Configurable |

Each `/score` command takes ~5-15 seconds depending on how many tokens the wallet traded.

**If you hit limits:**
- Requests will queue and execute in order
- Users might see a delay but won't lose their request
- Very heavy load may timeout (10s limit on free tier)

## How much does this cost?

**Vercel Free Tier includes:**
- 100GB bandwidth/month
- 100 hours serverless execution/month
- Plenty for a personal/small community bot

**Typical usage:**
- One `/score` command ≈ 5-10 seconds execution
- ~36,000 commands/month on free tier

## Can I add more commands?

Yes! Edit `api/webhook.js` to handle more commands:

```javascript
if (text.startsWith('/help')) {
  await sendTelegramMessage(chatId, 'Help message here');
}
```

## How do I update the bot?

```bash
# Make changes
git add .
git commit -m "Update: description"
git push

# Vercel auto-deploys on push!
```

---

# 📊 Scoring System

| Icon | Score | Meaning |
|------|-------|---------|
| 🔵 | +2 | Excellent - Bought dip, pumped >25% |
| 🟢 | +1 | Good - Bought dip, rose 10-25% |
| 🟡 | 0 | Neutral - Price stayed flat |
| 🟠 | -1 | Poor - Bought, dropped 10-25% |
| 🔴 | -2 | Terrible - Bought, dumped >25% |

## Supported Chains

| Command | Chain ID |
|---------|----------|
| sol, solana | 501 |
| eth, ethereum | 1 |
| bsc, bnb | 56 |
| base | 8453 |

---

# 🛠 Development

```bash
# Test locally
node index.js <wallet> <chain>

# Test API locally (requires Vercel CLI)
vercel dev

# View logs
vercel logs
```

## Project Structure

```
telegram-scorer/
├── index.js          # Core scoring logic
├── api/
│   └── webhook.js    # Vercel API handler for Telegram
├── package.json
├── vercel.json       # Vercel configuration
└── README.md
```

---

# 📄 License

MIT
