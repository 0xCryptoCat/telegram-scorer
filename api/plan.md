**Cryptomus Details:**

**Fees**: 0.4-2% on incoming payments (both custodial and non-custodial same pricing)
**Custodial wallet**: Single multi-chain wallet in Cryptomus, holds all chains/tokens, you withdraw manually
**Non-custodial**: Direct to your wallet(s) - same fees, just configure destination addresses per chain

---

## CORE ARCHITECTURE

```
┌─────────────────────────────────────────────────┐
│         VERCEL KV (Single Database)             │
│                                                 │
│  Users Table:                                   │
│  └─ userId: {credits, lastScan, totalScans,     │
│              premiumUntil}                      │
│                                                 │
│  Wallets Table:                                 │
│  └─ walletAddr: {score, lastScan, scannedBy,    │
│                  buys, sells, tokens}           │
└─────────────────────────────────────────────────┘
           ▲              ▲              ▲
           │              │              │
     ┌─────┴──────┐  ┌────┴─────┐  ┌────┴─────┐
     │ BOT APP    │  │ PAYMENT  │  │ SIGNAL   │
     │ (Vercel)   │  │ WEBHOOK  │  │ CRON     │
     │            │  │ (Vercel) │  │ (Vercel) │
     │ - Scans    │  │          │  │          │
     │ - Deducts  │  │ - Adds   │  │ - Reads  │
     │   credits  │  │   credits│  │   wallets│
     │ - Stores   │  │ - Grants │  │ - Posts  │
     │   wallets  │  │   premium│  │   signals│
     └────────────┘  └──────────┘  └──────────┘
```

---

## CREDIT SYSTEM FLOW

**Bot Side:**
1. User `/scan <wallet>` → check KV for `userId`
2. If no entry → create with `{credits: 3, lastScan: null, totalScans: 0, premiumUntil: null}`
3. If `credits > 0` → run scan
4. If scan valid → decrement credit, increment totalScans, update lastScan, store wallet in wallets table
5. If `credits = 0` → return message with Cryptomus payment link

**Payment Side (Webhook):**
```
User clicks Cryptomus paylink → pays
→ Cryptomus webhook hits your Vercel function
→ Verify payment signature
→ Extract userId from payment metadata
→ Add credits to user in KV: {credits += package_amount}
→ Return 200 OK
```

**Cryptomus Setup:**
- Create paylinks for packages: 10 scans ($10), 50 scans ($40), 200 scans ($120)
- Add `userId` to payment metadata field
- Set webhook URL to your Vercel function
- Funds go to Cryptomus wallet (custodial) or direct to yours (non-custodial)

---

## BOT USER FLOW

```
User → /start
Bot: "Welcome! You have 3 free scans.
     /scan <wallet> - Analyze wallet entry quality
     /buy - Purchase more scans"

User → /scan 0x123...
Bot: [runs scan]
     "Wallet Score: 1.82
      Entry Quality: Excellent
      Trades: 156 | Win Rate: 67%
      
      Credits remaining: 2"

User → /scan (after 3 uses)
Bot: "No credits remaining!
     
     Buy scan packs:
     🔹 10 scans - $10 [Pay]
     🔹 50 scans - $40 [Pay] ⭐ Best Value
     🔹 200 scans - $120 [Pay]
     
     Premium Channel: $50/month
     - Full wallet details in signals
     - Deep links to wallets
     - Entry amounts + scores"
```

---

## PREMIUM CHANNEL SYSTEM

**Add to user table**: `premiumUntil: timestamp`

**Cryptomus recurring subscription**:
- Create monthly subscription product ($50/mo)
- Webhook on payment → update `premiumUntil: now + 30 days`
- Webhook on cancellation → don't renew

**Telegram channel access**:
- User `/premium` → bot checks `premiumUntil`
- If expired → show Cryptomus subscription link
- On payment → bot generates invite link to private channel
- Bot posts: "Welcome @username to premium signals!"

**Signal posting logic**:
```javascript
// In signal cron job
if (3+ wallets bought token) {
  // Free channel
  postToFreeChannel("🚨 3 wallets (1.5-2.0) bought $TOKEN at $0.0123");
  
  // Premium channel  
  postToPremiumChannel(
    "🚨 3 wallets bought $TOKEN at $0.0123\n" +
    "- [wallet1](deeplink) (1.56): 12.3B for 1.2 ETH\n" +
    "- [wallet2](deeplink) (1.72): 2.61M for 0.02 ETH\n" +
    "- [wallet3](deeplink) (1.93): 1.1B for 0.12 ETH"
  );
}
```

**Telegram deep links**: `https://solscan.io/account/{walletAddr}` or custom bot command `/check_{walletAddr}`

---

**Cost estimate**: $0/month for 1000s of users on free tiers of Vercel KV + Functions + Cron.