/**
 * Vercel API Handler for Telegram Bot Webhook
 * 
 * Deploy this to Vercel and set as Telegram webhook.
 */

const { scoreWallet, formatTelegramMessage, parseCommand, CHAIN_MAP } = require('../index');

// Telegram Bot Token from environment
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Send message to Telegram
 */
async function sendTelegramMessage(chatId, text, replyToMessageId = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  
  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  return res.json();
}

/**
 * Main API handler
 */
module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { message } = req.body;
    
    // Ignore non-message updates
    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }
    
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const text = message.text.trim();
    
    // Check if it's a /score command
    if (!text.startsWith('/score')) {
      return res.status(200).json({ ok: true });
    }
    
    // Parse command
    const parsed = parseCommand(text);
    
    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        '❌ <b>Invalid command</b>\n\nUsage: /score &lt;wallet&gt; &lt;chain&gt;\n\nChains: sol, eth, bsc, base\n\nExample:\n<code>/score FCMXEqaS...fTCMBd sol</code>',
        messageId
      );
      return res.status(200).json({ ok: true });
    }
    
    // Send "processing" message
    await sendTelegramMessage(chatId, '⏳ Scoring wallet...', messageId);
    
    // Score the wallet
    const results = await scoreWallet(parsed.wallet, parsed.chainId);
    const responseText = formatTelegramMessage(results);
    
    // Send result
    await sendTelegramMessage(chatId, responseText, messageId);
    
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('Error:', error);
    
    // Try to notify user of error
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
      }
    } catch {}
    
    return res.status(200).json({ ok: true, error: error.message });
  }
};
