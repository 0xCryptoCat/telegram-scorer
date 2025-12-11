/**
 * Alphalert Telegram Wallet Scorer
 * 
 * Standalone script for scoring wallets via Telegram bot command.
 * Usage: /score <walletAddress> <chain>
 * Chain options: sol, eth, bsc, base
 * 
 * Can be deployed as:
 * - Vercel Edge Function
 * - Cloudflare Worker
 * - AWS Lambda
 * - Any Node.js serverless runtime
 */

// ============================================================
// CONFIGURATION
// ============================================================

const CHAIN_MAP = {
  sol: 501,
  solana: 501,
  eth: 1,
  ethereum: 1,
  bsc: 56,
  bnb: 56,
  base: 8453,
};

const CHAIN_NAMES = {
  501: 'Solana',
  1: 'Ethereum',
  56: 'BSC',
  8453: 'Base',
};

const LOOKBACK_MS = 8 * 60 * 60 * 1000;   // 8 hours before
const LOOKFORWARD_MS = 24 * 60 * 60 * 1000; // 24 hours after

// ============================================================
// OKX API ENDPOINTS
// ============================================================

const ENDPOINTS = {
  walletProfile: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/wallet-profile/query/address/info',
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  devTokens: 'https://web3.okx.com/priapi/v1/dx/market/v2/dev/analysis-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

// ============================================================
// FETCH HELPERS
// ============================================================

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWalletProfile(chainId, walletAddress) {
  const url = `${ENDPOINTS.walletProfile}?chainId=${chainId}&walletAddress=${walletAddress}&t=${Date.now()}`;
  const data = await fetchJson(url);
  
  if (data.code !== 0) return { isKol: false };
  
  const kolTag = data.data?.t?.find(tag => tag.k === 'kol');
  if (!kolTag) return { isKol: false };
  
  return {
    isKol: true,
    name: kolTag.e?.name || 'Unknown',
    twitter: kolTag.e?.kolTwitterLink || null,
  };
}

async function fetchDevAnalysis(chainId, walletAddress) {
  const url = `${ENDPOINTS.devTokens}?chainId=${chainId}&walletAddress=${walletAddress}&isDesc=true&sortBy=1&page=1&pageSize=1&filterRisk=false&filterUnmigrate=false&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== 0) return { isDev: false };
    
    const summary = data.data?.devAnalysisSummaryVO;
    if (!summary || !summary.createdTokenCount || summary.createdTokenCount === '0') {
      return { isDev: false };
    }
    
    return {
      isDev: true,
      tokenCount: parseInt(summary.createdTokenCount, 10),
      rugCount: parseInt(summary.ruggedTokenCount || '0', 10),
      goldenDogCount: parseInt(summary.goldenDogCount || '0', 10),
    };
  } catch {
    return { isDev: false };
  }
}

async function fetchTradingHistory(chainId, walletAddress, limit = 50) {
  const allTokens = [];
  let offset = 0;
  
  while (allTokens.length < limit) {
    const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${chainId}&isAsc=false&sortType=2&offset=${offset}&limit=20&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    
    const data = await fetchJson(url);
    if (data.code !== 0) break;
    
    allTokens.push(...data.data.tokenList);
    
    if (!data.data.hasNext || allTokens.length >= limit) break;
    offset = data.data.offset;
    
    await sleep(100);
  }
  
  return allTokens.slice(0, limit);
}

async function fetchCandles(chainId, tokenAddress, limit = 500) {
  const url = `${ENDPOINTS.candles}?chainId=${chainId}&address=${tokenAddress}&bar=15m&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== '0' && data.code !== 0) return [];
    
    return (data.data || []).map(c => ({
      timestamp: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// RELATIVE SCORER (Simplified from lib/core/relative-scorer.ts)
// ============================================================

function classifyBefore(entryPrice, beforeMin, beforeMax) {
  const riseToEntry = ((entryPrice - beforeMin) / beforeMin) * 100;
  const fallToEntry = ((beforeMax - entryPrice) / beforeMax) * 100;
  
  if (riseToEntry > 25 && riseToEntry > fallToEntry) return 'pumped_to';
  if (riseToEntry > 10 && riseToEntry > fallToEntry) return 'rose_to';
  if (fallToEntry > 25 && fallToEntry > riseToEntry) return 'dumped_to';
  if (fallToEntry > 10 && fallToEntry > riseToEntry) return 'fell_to';
  return 'flat';
}

function classifyAfter(entryPrice, afterMin, afterMax) {
  const pctUp = ((afterMax - entryPrice) / entryPrice) * 100;
  const pctDown = ((entryPrice - afterMin) / entryPrice) * 100;
  
  if (pctUp > 25 && pctUp > pctDown) return 'moon';
  if (pctUp > 10 && pctUp > pctDown) return 'pump';
  if (pctDown > 25 && pctDown > pctUp) return 'dump';
  if (pctDown > 10 && pctDown > pctUp) return 'dip';
  return 'flat';
}

function scoreBuy(beforeCtx, afterCtx) {
  const matrix = {
    'dumped_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'fell_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'flat': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'rose_to': { 'moon': 1, 'pump': 0, 'flat': -1, 'dip': -2, 'dump': -2 },
    'pumped_to': { 'moon': 0, 'pump': -1, 'flat': -1, 'dip': -2, 'dump': -2 },
  };
  return matrix[beforeCtx]?.[afterCtx] ?? 0;
}

function scoreEntry(entryPrice, entryTime, candles) {
  const beforeCandles = candles.filter(c => 
    c.timestamp < entryTime && c.timestamp >= entryTime - LOOKBACK_MS
  );
  const afterCandles = candles.filter(c => 
    c.timestamp > entryTime && c.timestamp <= entryTime + LOOKFORWARD_MS
  );
  
  const beforeMin = beforeCandles.length > 0 
    ? Math.min(...beforeCandles.map(c => c.low)) 
    : entryPrice;
  const beforeMax = beforeCandles.length > 0 
    ? Math.max(...beforeCandles.map(c => c.high)) 
    : entryPrice;
  const afterMin = afterCandles.length > 0 
    ? Math.min(...afterCandles.map(c => c.low)) 
    : entryPrice;
  const afterMax = afterCandles.length > 0 
    ? Math.max(...afterCandles.map(c => c.high)) 
    : entryPrice;
  
  const beforeCtx = classifyBefore(entryPrice, beforeMin, beforeMax);
  const afterCtx = classifyAfter(entryPrice, afterMin, afterMax);
  
  return scoreBuy(beforeCtx, afterCtx);
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

async function scoreWallet(walletAddress, chainId, maxTokens = 30) {
  const results = {
    wallet: walletAddress,
    chain: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
    chainId,
    timestamp: new Date().toISOString(),
    kol: null,
    dev: null,
    tokens: [],
    stats: {
      totalTokens: 0,
      totalBuys: 0,
      avgScore: 0,
      distribution: { excellent: 0, good: 0, neutral: 0, poor: 0, terrible: 0 },
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalBagsValue: 0,
      rugged: 0,
      held: 0,
    },
  };
  
  // Fetch wallet profile and dev status in parallel
  const [kolInfo, devInfo] = await Promise.all([
    fetchWalletProfile(chainId, walletAddress),
    fetchDevAnalysis(chainId, walletAddress),
  ]);
  
  results.kol = kolInfo;
  results.dev = devInfo;
  
  // Fetch trading history
  const tokens = await fetchTradingHistory(chainId, walletAddress, maxTokens);
  
  // Filter to 7d window
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentTokens = tokens.filter(t => 
    t.latestTime && parseInt(t.latestTime, 10) >= sevenDaysAgo
  );
  
  results.stats.totalTokens = recentTokens.length;
  
  const allScores = [];
  
  // Score each token
  for (const token of recentTokens.slice(0, maxTokens)) {
    const tokenAddress = token.tokenContractAddress;
    const symbol = token.tokenSymbol || 'UNKNOWN';
    
    // Fetch candles
    const candles = await fetchCandles(chainId, tokenAddress);
    
    // Parse token data
    const buyCount = token.totalTxBuy || 0;
    const buyAvgPrice = parseFloat(token.buyAvgPrice) || 0;
    const buyVolume = parseFloat(token.buyVolume) || 0;
    const sellVolume = parseFloat(token.sellVolume) || 0;
    const balance = parseFloat(token.balance) || 0;
    const balanceUsd = parseFloat(token.balanceUsd) || 0;
    const realizedPnl = parseFloat(token.realizedPnl) || 0;
    const unrealizedPnl = parseFloat(token.unrealizedPnl) || 0;
    const totalPnl = parseFloat(token.totalPnl) || 0;
    
    // Calculate multiplier: total value returned vs total invested
    // Total returned = what you sold + what you still hold
    // multiplier = (sellVolume + balanceUsd) / buyVolume
    const totalReturned = sellVolume + balanceUsd;
    const multiplier = buyVolume > 0 ? totalReturned / buyVolume : 0;
    
    // Check for rug
    let isRugged = false;
    let rugPct = 0;
    if (candles.length > 0) {
      const currentPrice = candles.sort((a, b) => b.timestamp - a.timestamp)[0].close;
      const peakPrice = Math.max(...candles.map(c => c.high));
      if (peakPrice > 0) {
        rugPct = ((peakPrice - currentPrice) / peakPrice) * 100;
        isRugged = rugPct >= 90;
      }
    }
    
    // Score entries
    let score = 0;
    if (candles.length > 0 && buyCount > 0 && buyAvgPrice > 0) {
      // Find closest candle to buy avg price
      const closestCandle = candles.reduce((best, c) => 
        Math.abs(c.close - buyAvgPrice) < Math.abs(best.close - buyAvgPrice) ? c : best
      );
      score = scoreEntry(buyAvgPrice, closestCandle.timestamp, candles);
      
      // Add score for each buy
      for (let i = 0; i < buyCount; i++) {
        allScores.push(score);
      }
    }
    
    // Track stats
    results.stats.realizedPnl += realizedPnl;
    results.stats.unrealizedPnl += unrealizedPnl;
    if (balance > 0) results.stats.totalBagsValue += balanceUsd;
    if (isRugged) results.stats.rugged++;
    if (balance > 0) results.stats.held++;
    
    // Count distribution
    if (score === 2) results.stats.distribution.excellent++;
    else if (score === 1) results.stats.distribution.good++;
    else if (score === 0) results.stats.distribution.neutral++;
    else if (score === -1) results.stats.distribution.poor++;
    else if (score === -2) results.stats.distribution.terrible++;
    
    results.tokens.push({
      symbol,
      address: tokenAddress,
      buyCount,
      sellCount: token.totalTxSell || 0,
      score,
      pnl: totalPnl,
      balanceUsd,
      multiplier,
      isRugged,
      holding: balance > 0,
    });
    
    // Rate limit
    await sleep(100);
  }
  
  // Calculate aggregate
  results.stats.totalBuys = allScores.length;
  results.stats.avgScore = allScores.length > 0 
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length 
    : 0;
  
  return results;
}

// ============================================================
// TELEGRAM MESSAGE FORMATTER
// ============================================================

// Explorer URLs by chain
const EXPLORERS = {
  501: { name: 'Solscan', wallet: 'https://solscan.io/account/', token: 'https://solscan.io/token/' },
  1: { name: 'Etherscan', wallet: 'https://etherscan.io/address/', token: 'https://etherscan.io/token/' },
  56: { name: 'BscScan', wallet: 'https://bscscan.com/address/', token: 'https://bscscan.com/token/' },
  8453: { name: 'Basescan', wallet: 'https://basescan.org/address/', token: 'https://basescan.org/token/' },
};

/**
 * Format large numbers with K, M, B suffixes
 */
function formatAmount(num) {
  const absNum = Math.abs(num);
  const sign = num >= 0 ? '+' : '-';
  
  if (absNum >= 1_000_000_000) {
    return `${sign}$${(absNum / 1_000_000_000).toFixed(1)}B`;
  }
  if (absNum >= 1_000_000) {
    return `${sign}$${(absNum / 1_000_000).toFixed(1)}M`;
  }
  if (absNum >= 1_000) {
    return `${sign}$${(absNum / 1_000).toFixed(1)}K`;
  }
  if (absNum >= 1) {
    return `${sign}$${absNum.toFixed(0)}`;
  }
  return `${sign}$${absNum.toFixed(2)}`;
}

/**
 * Format multiplier with K, M suffixes for large values
 * Losses shown as negative: -0.68x means lost 68%
 * Gains shown as positive: 2.50x means 2.5x return
 */
function formatMultiplier(mult) {
  if (mult < 0) mult = 0;
  
  // Losses: convert to negative (0.32x becomes -0.68x)
  if (mult < 1) {
    const loss = mult - 1; // e.g., 0.32 - 1 = -0.68
    return `${loss.toFixed(2)}x`;
  }
  
  // Gains
  if (mult >= 1_000_000) {
    return `${(mult / 1_000_000).toFixed(1)}Mx`;
  }
  if (mult >= 1_000) {
    return `${(mult / 1_000).toFixed(1)}Kx`;
  }
  if (mult >= 100) {
    return `${mult.toFixed(0)}x`;
  }
  if (mult >= 10) {
    return `${mult.toFixed(1)}x`;
  }
  return `${mult.toFixed(2)}x`;
}

/**
 * Get score icon: 🔵 +2, 🟢 +1, 🟡 0, 🟠 -1, 🔴 -2
 */
function getScoreIcon(score) {
  if (score >= 2) return '🔵';
  if (score >= 1) return '🟢';
  if (score >= 0) return '🟡';
  if (score >= -1) return '🟠';
  return '🔴';
}

/**
 * Get quality rating with icon
 */
function getQualityRating(avgScore) {
  if (avgScore >= 1.5) return '🔵 Excellent';
  if (avgScore >= 0.5) return '🟢 Good';
  if (avgScore >= -0.5) return '🟡 Neutral';
  if (avgScore >= -1.5) return '🟠 Poor';
  return '🔴 Terrible';
}

function formatTelegramMessage(results) {
  const { wallet, chain, chainId, kol, dev, stats, tokens } = results;
  
  const explorer = EXPLORERS[chainId] || EXPLORERS[501];
  const walletUrl = `${explorer.wallet}${wallet}`;
  const walletShort = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  
  const lines = [];
  
  // Header with wallet link
  lines.push(`Scored Wallet: <a href="${walletUrl}">${walletShort}</a>`);
  
  // Profile badges (each on own line)
  if (kol?.isKol) {
    lines.push(`👑 KOL: ${kol.name}`);
  }
  if (dev?.isDev) {
    lines.push(`🛠 Dev: ${dev.tokenCount} tokens, ${dev.rugCount} rugs`);
  }
  
  lines.push(``);
  
  // Main score
  const quality = getQualityRating(stats.avgScore);
  lines.push(`Score: ${stats.avgScore.toFixed(2)} ${quality}`);
  lines.push(`Tokens: ${stats.totalTokens} | Entries: ${stats.totalBuys}`);
  
  // Distribution on single line: 🔵 4 | 🟢 0 | 🟡 2 | 🟠 0 | 🔴 3
  const { excellent, good, neutral, poor, terrible } = stats.distribution;
  lines.push(`🔵 ${excellent} | 🟢 ${good} | 🟡 ${neutral} | 🟠 ${poor} | 🔴 ${terrible}`);
  
  lines.push(``);
  
  // PnL & Holdings
  lines.push(`Realized PnL: ${formatAmount(stats.realizedPnl)}`);
  if (stats.totalBagsValue > 0) {
    lines.push(`Holdings: ${formatAmount(stats.totalBagsValue).replace(/^\+/, '')} (${stats.held} tokens)`);
  }
  
  // Rug info
  if (stats.rugged > 0) {
    const rugPct = ((stats.rugged / stats.totalTokens) * 100).toFixed(0);
    lines.push(`Rugged: ${stats.rugged}/${stats.totalTokens} (${rugPct}%)`);
  } else {
    lines.push(`Rugged: 0/${stats.totalTokens}`);
  }
  
  lines.push(``);
  
  // Top tokens (max 5) with links - sort by bag value if holding, else by PnL
  const sortedTokens = [...tokens].sort((a, b) => {
    // Prioritize held tokens by their bag value
    if (a.holding && b.holding) return b.balanceUsd - a.balanceUsd;
    if (a.holding) return -1;
    if (b.holding) return 1;
    return b.pnl - a.pnl;
  });
  const topTokens = sortedTokens.slice(0, 5);
  
  if (topTokens.length > 0) {
    lines.push(`<b>Top Tokens</b>`);
    topTokens.forEach(t => {
      const icon = getScoreIcon(t.score);
      const tokenUrl = `${explorer.token}${t.address}`;
      const trades = `(${t.buyCount}↗ | ${t.sellCount}↘)`;
      
      // Show bag value for held tokens, PnL for sold, always show multiplier
      let valueStr;
      if (t.holding && t.balanceUsd > 0) {
        valueStr = formatAmount(t.balanceUsd).replace(/^\+/, '');
      } else {
        valueStr = formatAmount(t.pnl);
      }
      
      // Always show multiplier
      const multStr = ` 💰 ${formatMultiplier(t.multiplier)}`;
      
      const extras = [];
      if (t.isRugged) extras.push('💀');
      const extraStr = extras.length > 0 ? ` ${extras.join('')}` : '';
      
      lines.push(`${icon} <a href="${tokenUrl}">${t.symbol}</a>: ${valueStr}${multStr} ${trades}${extraStr}`);
    });
  }
  
  return lines.join('\n');
}

// ============================================================
// EXPORTS FOR DIFFERENT RUNTIMES
// ============================================================

/**
 * Parse command from Telegram message
 * Formats: 
 *   /score <wallet> <chain>
 *   /score <wallet>
 *   /score@botname <wallet> <chain>  (group format)
 */
function parseCommand(text) {
  // Strip @botname suffix that Telegram adds in groups
  const cleanText = text.replace(/^\/score(@\w+)?/, '/score');
  
  const match = cleanText.match(/^\/score\s+([A-Za-z0-9]{32,44})\s*(\w+)?/i);
  if (!match) return null;
  
  const wallet = match[1];
  const chainArg = (match[2] || 'sol').toLowerCase();
  const chainId = CHAIN_MAP[chainArg];
  
  if (!chainId) return null;
  
  return { wallet, chainId };
}

/**
 * Main handler for serverless/edge functions
 */
async function handleScoreRequest(walletAddress, chainId) {
  const results = await scoreWallet(walletAddress, chainId);
  return formatTelegramMessage(results);
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node index.js <walletAddress> [chain]');
    console.log('');
    console.log('Chains: sol, eth, bsc, base');
    console.log('');
    console.log('Examples:');
    console.log('  node index.js FCMXEqaSGdEHbufTCMBdG9kDd5MvU9tQmWqPn9yXF9qb sol');
    console.log('  node index.js 0x1234...5678 eth');
    process.exit(1);
  }
  
  const wallet = args[0];
  const chainArg = (args[1] || 'sol').toLowerCase();
  const chainId = CHAIN_MAP[chainArg];
  
  if (!chainId) {
    console.error(`Unknown chain: ${chainArg}`);
    console.error('Valid chains: sol, eth, bsc, base');
    process.exit(1);
  }
  
  console.log(`Scoring wallet ${wallet.slice(0, 8)}... on ${CHAIN_NAMES[chainId]}...\n`);
  
  try {
    const results = await scoreWallet(wallet, chainId);
    
    // Print raw message (would be sent to Telegram)
    const message = formatTelegramMessage(results);
    
    // Convert HTML to terminal-friendly format
    const terminalMessage = message
      .replace(/<b>/g, '\x1b[1m')
      .replace(/<\/b>/g, '\x1b[0m')
      .replace(/<i>/g, '\x1b[3m')
      .replace(/<\/i>/g, '\x1b[0m')
      .replace(/<code>/g, '')
      .replace(/<\/code>/g, '')
      .replace(/<a href="[^"]*">([^<]*)<\/a>/g, '\x1b[4m$1\x1b[0m');
    
    console.log(terminalMessage);
    
    // Also save raw data
    console.log('\n--- Raw JSON ---');
    console.log(JSON.stringify(results, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly (not when required as module)
if (require.main === module) {
  main();
}

// Export for serverless use
module.exports = {
  scoreWallet,
  formatTelegramMessage,
  handleScoreRequest,
  parseCommand,
  CHAIN_MAP,
};
