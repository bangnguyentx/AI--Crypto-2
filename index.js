/**
 * Main Telegram AI Trading Bot - Production Ready
 * Supports TOP 10 coins with ensemble signal detection
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
const express = require('express');
const { analyzeSymbol } = require('./analysisAdapter');

// --- CONFIGURATION ---
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// --- BOT CONFIGURATION WITH POLLING ERROR HANDLING ---
const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Handle polling errors to prevent app crashes
bot.on("polling_error", (err) => {
  if (err.code !== 'EFATAL') {
    console.log(`[Polling Error] ${err.code}: ${err.message}`);
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

// TOP 10 COINS - Configurable via environment variable
const TARGET_COINS = process.env.TARGET_COINS 
  ? process.env.TARGET_COINS.split(',') 
  : [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
      'ADAUSDT', 'MATICUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT'
    ];

// --- ADMIN SYSTEM & KEY MANAGEMENT ---
const ADMIN_IDS = (process.env.ADMIN_IDS || '8560521739').split(',');
const activationKeys = new Map(); // Stores keys: {type, created, expires, used, usedBy}
const subscribedUsers = new Map(); // Active users: {userInfo, activatedAt, keyUsed}

// --- STATUS VARIABLES ---
let signalCountToday = 0;
let isAutoAnalysisRunning = false;

// --- EXPRESS SERVER (KEEP-ALIVE) ---
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'AI Trading Bot V3 is Running...',
    version: '3.0.0',
    subscribedUsers: subscribedUsers.size,
    lastSignalCount: signalCountToday,
    targetCoins: TARGET_COINS,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    users: subscribedUsers.size,
    signals: signalCountToday,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🤖 Bot initialized with ${TARGET_COINS.length} target coins`);
});

// --- UTILITY FUNCTIONS ---

function getVietnamTime() {
  return moment().tz("Asia/Ho_Chi_Minh");
}

function isAdmin(user) {
  return ADMIN_IDS.includes(user.id.toString());
}

function generateKey(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function calculateKeyExpiry(type) {
  const now = new Date();
  switch (type) {
    case '1week':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case '1month':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    case '3month':
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    case 'forever':
      return null;
    default:
      return null;
  }
}

function formatSignalMessage(data, signalIndex, source = 'bot') {
  const icon = data.direction === 'LONG' ? '🟢' : '🔴';

  const fmt = (num) => { 
    if (num === undefined || num === null) return 'N/A'; 
    const number = parseFloat(num); 
    if (isNaN(number)) return 'N/A'; 
    return number > 10 ? number.toFixed(2) : number.toFixed(4); 
  }; 

  const baseMessage = `🤖 AI Trading Signal [${signalIndex} today] 

#${data.symbol.replace('USDT', '')} – ${data.direction} 📌

${icon} Entry: ${fmt(data.entry)}
🎯 Take Profit: ${fmt(data.tp)}
🛑 Stop-Loss: ${fmt(data.sl)}
📊 Risk/Reward: ${data.rr} (Confidence: ${data.confidence}%)`;

  const riskWarning = `\n\n🧠 AI Ensemble Analysis 

⚠️ RISK MANAGEMENT REQUIRED – Max 2-3% risk per trade
💡 Use proper position sizing
🔒 Always use stop losses`;

  return baseMessage + riskWarning; 
}

// Broadcast function with retry mechanism
async function broadcastToAllUsers(message) {
  let successCount = 0;
  let failCount = 0;

  for (const [chatId, userData] of subscribedUsers) { 
    let retryCount = 0; 
    const maxRetries = 3; 
    let sent = false; 
    
    while (retryCount < maxRetries && !sent) { 
      try { 
        await bot.sendMessage(chatId, message); 
        successCount++; 
        sent = true; 
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100)); 
      } catch (err) { 
        retryCount++; 
        console.log(`❌ Failed to send to ${userData.userInfo.username || userData.userInfo.first_name} (attempt ${retryCount}):`, err.message); 
        
        if (retryCount >= maxRetries) { 
          failCount++; 
          // Remove user if blocked the bot
          if (err.response && err.response.statusCode === 403) { 
            subscribedUsers.delete(chatId); 
            console.log(`🗑️ Removed blocked user: ${userData.userInfo.username || userData.userInfo.first_name}`); 
          } 
        } else {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); 
        } 
      } 
    } 
  } 
  
  console.log(`📤 Broadcast completed: ${successCount} successful, ${failCount} failed`); 
  return { success: successCount, fail: failCount }; 
}

// --- AUTO ANALYSIS SCHEDULER ---
async function runAutoAnalysis() {
  if (isAutoAnalysisRunning) {
    console.log('⏳ Auto analysis already running, skipping...');
    return;
  }

  const now = getVietnamTime(); 
  const currentHour = now.hours(); 
  const currentMinute = now.minutes(); 
  
  // Only run during trading hours (4:00 - 23:30 Vietnam time)
  if (currentHour < 4 || (currentHour === 23 && currentMinute > 30)) { 
    console.log('💤 Outside trading hours (04:00 - 23:30). Sleeping...'); 
    return; 
  } 
  
  if (subscribedUsers.size === 0) { 
    console.log('👥 No subscribed users. Skipping auto analysis.'); 
    return; 
  } 
  
  isAutoAnalysisRunning = true; 
  console.log(`🔄 Starting Auto Analysis at ${now.format('HH:mm')} - ${subscribedUsers.size} users`);
  
  let signalsFound = 0; 
  let analyzedCount = 0; 
  
  try { 
    for (const coin of TARGET_COINS) { 
      analyzedCount++; 
      
      // Rate limiting delay between coins
      const baseDelay = process.env.REQUEST_DELAY_MS || 5000;
      await new Promise(r => setTimeout(r, baseDelay)); 
      
      try { 
        console.log(`🔍 Analyzing ${coin} (${analyzedCount}/${TARGET_COINS.length})...`); 
        const result = await analyzeSymbol(coin); 
        
        if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') { 
          if (result.confidence >= (process.env.MIN_CONFIDENCE || 60)) { 
            signalCountToday++; 
            signalsFound++; 
            const msg = formatSignalMessage(result, signalCountToday, 'bot'); 
            console.log(`✅ Signal found: ${coin} ${result.direction} (${result.confidence}% confidence)`); 
            
            await broadcastToAllUsers(msg); 
            // Additional delay after broadcasting signal
            await new Promise(r => setTimeout(r, 3000)); 
          } else { 
            console.log(`⏭️ Skip ${coin}: Confidence ${result.confidence}% below minimum`); 
          } 
        } else { 
          console.log(`➖ No signal for ${coin}: ${result?.direction} - ${result?.reason}`); 
        } 
      } catch (coinError) { 
        console.error(`❌ Error analyzing ${coin}:`, coinError.message); 
        continue; 
      } 
    } 
    
    console.log(`🎯 Auto analysis completed. Found ${signalsFound} signals out of ${TARGET_COINS.length} coins`); 
  } catch (error) { 
    console.error('💥 Critical error in auto analysis:', error); 
  } finally { 
    isAutoAnalysisRunning = false; 
  } 
}

// Daily greeting function
function checkDailyGreeting() {
  const now = getVietnamTime();
  if (now.hours() === 4 && now.minutes() === 0) {
    signalCountToday = 0;
    const greetingMsg = "🌞 Good morning traders! AI Trading Bot V3 is ready to find opportunities. Wishing you big wins today! 🚀";
    broadcastToAllUsers(greetingMsg);
    console.log('🌞 Sent morning greeting to all users');
  }
}

// --- BOT COMMAND HANDLERS ---

// /start - REGISTER FOR MESSAGES
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  const userInfo = { 
    id: user.id, 
    username: user.username, 
    first_name: user.first_name, 
    last_name: user.last_name 
  }; 
  
  // Check if user is admin
  if (isAdmin(user)) { 
    const adminData = { 
      userInfo: userInfo, 
      activatedAt: new Date(), 
      isAdmin: true 
    }; 
    subscribedUsers.set(chatId, adminData); 
    
    const welcomeMsg = `👋 Welcome Admin ${user.first_name || ''}!\n🧠 AI TRADING BOT V3 - ENSEMBLE EDITION\n\nYou have been automatically granted admin privileges!`; 
    const opts = { 
      reply_markup: { 
        keyboard: [ 
          ['📤 Broadcast Signal', '🔍 Analyze Symbol'], 
          ['📊 Bot Status', '🔑 Generate Key'], 
          ['🔎 Analyze All Coins'] 
        ], 
        resize_keyboard: true, 
        one_time_keyboard: false 
      } 
    }; 
    bot.sendMessage(chatId, welcomeMsg, opts); 
    console.log(`✅ Admin subscribed: ${user.username || user.first_name} (ID: ${user.id})`); 
  } else { 
    // Regular user - show activation instructions
    const welcomeMsg = `👋 Welcome ${user.first_name || 'Trader'}!\n🧠 AI TRADING BOT V3 - ENSEMBLE EDITION\n\n🔐 You need an activation key to access all features.\n\n📝 Use command: /key <activation_code>`; 
    bot.sendMessage(chatId, welcomeMsg); 
  } 
});

// /key - ACTIVATE USER
bot.onText(/\/key (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const key = match[1].trim();

  // Check if key exists and is valid
  const keyInfo = activationKeys.get(key); 
  if (!keyInfo) { 
    return bot.sendMessage(chatId, '❌ Activation key does not exist!'); 
  } 
  if (keyInfo.used) { 
    return bot.sendMessage(chatId, '❌ Activation key has already been used!'); 
  } 
  // Check expiration
  if (keyInfo.expires && new Date() > keyInfo.expires) { 
    return bot.sendMessage(chatId, '❌ Activation key has expired!'); 
  } 
  
  // Activate the key
  keyInfo.used = true; 
  keyInfo.usedBy = user.id; 
  activationKeys.set(key, keyInfo); 
  
  // Add user to active subscribers
  const userData = { 
    userInfo: { 
      id: user.id, 
      username: user.username, 
      first_name: user.first_name, 
      last_name: user.last_name 
    }, 
    activatedAt: new Date(), 
    keyUsed: key, 
    isAdmin: false 
  }; 
  subscribedUsers.set(chatId, userData); 
  
  const opts = { 
    reply_markup: { 
      keyboard: [ 
        ['📤 Broadcast Signal'], 
        ['🔍 Analyze Symbol'] 
      ], 
      resize_keyboard: true, 
      one_time_keyboard: false 
    } 
  }; 
  
  bot.sendMessage(chatId, `✅ Activation successful! Welcome to AI Trading Bot V3.`, opts); 
  console.log(`✅ User activated: ${user.username || user.first_name} with key: ${key}`); 
});

// /createkey - GENERATE ACTIVATION KEY (ADMIN ONLY)
bot.onText(/\/createkey (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!isAdmin(user)) { 
    return bot.sendMessage(chatId, '❌ You do not have permission to use this command!'); 
  } 
  
  const type = match[1].trim(); 
  const validTypes = ['1week', '1month', '3month', 'forever']; 
  if (!validTypes.includes(type)) { 
    return bot.sendMessage(chatId, `❌ Invalid key type! Valid types: ${validTypes.join(', ')}`); 
  } 
  
  const key = generateKey(); 
  const expires = calculateKeyExpiry(type); 
  
  activationKeys.set(key, { 
    type: type, 
    created: new Date(), 
    expires: expires, 
    used: false, 
    usedBy: null 
  }); 
  
  const expiryText = expires ? moment(expires).format('DD/MM/YYYY HH:mm') : 'Permanent'; 
  bot.sendMessage(chatId, 
    `✅ Key created successfully!\n\n` + 
    `🔑 Key: <code>${key}</code>\n` + 
    `⏰ Type: ${type}\n` + 
    `📅 Expires: ${expiryText}\n\n` + 
    `Send this key to users for activation: /key ${key}`, 
    { parse_mode: 'HTML' } 
  ); 
});

// Handle menu button clicks
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userData = subscribedUsers.get(chatId);

  if (!userData) { 
    if (text.startsWith('/key')) return; 
    return bot.sendMessage(chatId, '🔐 Please activate the bot first using /key <activation_code>!'); 
  } 
  
  const user = userData.userInfo; 
  const isAdminUser = userData.isAdmin; 
  
  // Handle menu buttons
  if (text === '📤 Broadcast Signal') { 
    const helpMsg = `To broadcast a signal to the community, use the format:\n\n` + 
      `🔹 <b>Example 1:</b> <code>/signal BTCUSDT LONG 50000 49000 52000</code>\n` + 
      `🔹 <b>Example 2:</b> <code>/signal ETHUSDT SHORT 2500 2550 2400</code>\n\n` + 
      `📝 <b>Format:</b> /signal [SYMBOL] [LONG/SHORT] [ENTRY] [STOPLOSS] [TAKEPROFIT]`; 
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' }); 
  } else if (text === '🔍 Analyze Symbol') { 
    const helpMsg = isAdminUser ? 
      'To analyze a coin, use:\n<code>/analyzesymbol BTCUSDT</code>\n\nOr analyze all coins:\n<code>/analyzesymbol Allcoin</code>' : 
      'To analyze a coin, use:\n<code>/analyzesymbol BTCUSDT</code>'; 
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' }); 
  } else if (text === '📊 Bot Status' && isAdminUser) { 
    const statusMsg = `🤖 <b>BOT STATUS</b>\n\n` + 
      `👥 Active users: <b>${subscribedUsers.size}</b>\n` + 
      `📈 Signals today: <b>${signalCountToday}</b>\n` + 
      `⏰ Operating hours: <b>04:00 - 23:30</b>\n` + 
      `🔄 Scan interval: <b>2 hours</b>\n` + 
      `🎯 Min confidence: <b>${process.env.MIN_CONFIDENCE || 60}%</b>\n` + 
      `💰 Account balance: <b>$${process.env.ACCOUNT_BALANCE || 1000}</b>`; 
    bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' }); 
  } else if (text === '🔑 Generate Key' && isAdminUser) { 
    const helpMsg = `To generate activation keys, use:\n\n` + 
      `<code>/createkey 1week</code>\n` + 
      `<code>/createkey 1month</code>\n` + 
      `<code>/createkey 3month</code>\n` + 
      `<code>/createkey forever</code>`; 
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' }); 
  } else if (text === '🔎 Analyze All Coins' && isAdminUser) { 
    bot.sendMessage(chatId, 'Analyzing all 10 coins...'); 
    analyzeAllCoins(chatId); 
  } 
  
  // Handle manual signal broadcasting
  if (text.startsWith('/signal')) { 
    const parts = text.split(' '); 
    if (parts.length < 6) { 
      return bot.sendMessage(chatId, 
        '❌ <b>Invalid format!</b>\n\n' + 
        '✅ <b>Correct format:</b> <code>/signal SYMBOL LONG/SHORT ENTRY STOPLOSS TAKEPROFIT</code>\n\n' + 
        '📝 <b>Example:</b> <code>/signal BTCUSDT LONG 50000 49000 52000</code>', 
        { parse_mode: 'HTML' } 
      ); 
    } 
    
    const symbol = parts[1].toUpperCase(); 
    const direction = parts[2].toUpperCase(); 
    const entry = parts[3]; 
    const sl = parts[4]; 
    const tp = parts[5]; 
    
    if (!['LONG', 'SHORT'].includes(direction)) { 
      return bot.sendMessage(chatId, '❌ Direction must be LONG or SHORT'); 
    } 
    if (isNaN(entry) || isNaN(sl) || isNaN(tp)) { 
      return bot.sendMessage(chatId, '❌ Entry, SL, TP must be numbers'); 
    } 
    
    const rr = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2); 
    const userName = isAdminUser ? 'Admin' : (user.username ? `@${user.username}` : user.first_name); 
    
    signalCountToday++; 
    const userSignalMsg = `🤖 Manual Signal [${signalCountToday} today]\n` + 
      `#${symbol.replace('USDT', '')} – ${direction} 📌\n\n` + 
      `🟢 Entry: ${parseFloat(entry).toFixed(2)}\n` + 
      `🎯 Take Profit: ${parseFloat(tp).toFixed(2)}\n` + 
      `🛑 Stop-Loss: ${parseFloat(sl).toFixed(2)}\n` + 
      `📊 Risk/Reward: ${rr}\n\n` + 
      `👤 Shared by ${userName}\n\n` + 
      `⚠️ Always practice risk management – Max 1-2% risk\n` +
      `💡 Manual signal - verify before trading`; 
    
    const broadcastResult = await broadcastToAllUsers(userSignalMsg); 
    bot.sendMessage(chatId, 
      `✅ Signal sent to ${broadcastResult.success} users!\n` + 
      `❌ ${broadcastResult.fail} failed deliveries` 
    ); 
  } 
});

// /analyzesymbol [Coin] command handler
bot.onText(/\/analyzesymbol (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userData = subscribedUsers.get(chatId);

  if (!userData) { 
    return bot.sendMessage(chatId, 'Please activate the bot first using /key!'); 
  } 
  
  let symbol = match[1].toUpperCase().trim(); 
  
  // Check if analyzing all coins (admin only)
  if (symbol === 'ALLCOIN') { 
    if (!userData.isAdmin) { 
      return bot.sendMessage(chatId, '❌ Only admins can analyze all coins!'); 
    } 
    return analyzeAllCoins(chatId); 
  } 
  
  // Analyze specific coin
  if (!symbol.endsWith('USDT')) symbol += 'USDT'; 
  
  const processingMsg = await bot.sendMessage(chatId, 
    `⏳ Analyzing ${symbol}...\n📊 Loading multi-timeframe analysis`
  ); 
  
  try { 
    const result = await analyzeSymbol(symbol); 
    
    if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') { 
      bot.deleteMessage(chatId, processingMsg.message_id); 
      
      let advice = ""; 
      if (result.confidence < 60) { 
        advice = "\n\n⚠️ <b>Warning:</b> Low Confidence Score (<60%), high risk - DO NOT TRADE"; 
      } else if (result.confidence >= 80) { 
        advice = "\n\n✅ <b>High Confidence</b> - Consider trading with proper risk management"; 
      } else { 
        advice = "\n\n🟡 <b>Medium Confidence</b> - Trade with caution and proper risk management"; 
      } 
      
      const msgContent = formatSignalMessage(result, "MANUAL") + advice; 
      bot.sendMessage(chatId, msgContent, { parse_mode: 'HTML' }); 
    } else { 
      bot.editMessageText( 
        `❌ No trading signal found for ${symbol}\n` + 
        `📊 Market: ${result?.direction || 'NEUTRAL'}\n` + 
        `🎯 Confidence: ${result?.confidence || 0}%\n` +
        `💡 Reason: ${result?.reason || 'No clear signal'}`,
        { chat_id: chatId, message_id: processingMsg.message_id } 
      ); 
    } 
  } catch (error) { 
    bot.editMessageText( 
      `❌ Error analyzing ${symbol}: ${error.message}`, 
      { chat_id: chatId, message_id: processingMsg.message_id } 
    ); 
  } 
});

// Function to analyze all coins (admin only)
async function analyzeAllCoins(chatId) {
  const processingMsg = await bot.sendMessage(chatId, 
    `⏳ Analyzing all ${TARGET_COINS.length} coins...\n📊 This may take 3-5 minutes`
  );

  let signalsFound = 0; 
  let analysisResults = []; 
  
  try { 
    for (let i = 0; i < TARGET_COINS.length; i++) { 
      const coin = TARGET_COINS[i]; 
      
      // Update progress
      if (i % 5 === 0) { 
        const progress = Math.round((i / TARGET_COINS.length) * 100); 
        bot.editMessageText( 
          `⏳ Analyzing all ${TARGET_COINS.length} coins...\n📊 Progress: ${progress}% (${i}/${TARGET_COINS.length})`, 
          { chat_id: chatId, message_id: processingMsg.message_id } 
        ); 
      } 
      
      await new Promise(r => setTimeout(r, 2000)); // 2 second delay per coin
      
      try { 
        const result = await analyzeSymbol(coin); 
        if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE' && result.confidence >= 60) { 
          signalsFound++; 
          analysisResults.push(result); 
        } 
      } catch (error) { 
        console.error(`Error analyzing ${coin}:`, error.message); 
      } 
    } 
    
    bot.deleteMessage(chatId, processingMsg.message_id); 
    
    if (analysisResults.length > 0) { 
      let response = `🔍 <b>COMPLETE COIN ANALYSIS RESULTS</b>\n` + 
        `📈 Found: <b>${signalsFound}</b> signals\n\n`; 
      
      // Show top 5 best signals
      const bestSignals = analysisResults 
        .sort((a, b) => b.confidence - a.confidence) 
        .slice(0, 5); 
      
      for (const result of bestSignals) { 
        response += `🎯 <b>${result.symbol.replace('USDT', '')}</b> - ${result.direction} (${result.confidence}%)\n`; 
        response += `📍 Entry: ${result.entry} | SL: ${result.sl} | TP: ${result.tp}\n\n`; 
      } 
      
      if (signalsFound > 5) { 
        response += `... and ${signalsFound - 5} more signals`; 
      } 
      
      bot.sendMessage(chatId, response, { parse_mode: 'HTML' }); 
    } else { 
      bot.sendMessage(chatId, '❌ No signals found in 10 coins (Confidence ≥ 60%).'); 
    } 
  } catch (error) { 
    bot.editMessageText( 
      `❌ Error analyzing all coins: ${error.message}`, 
      { chat_id: chatId, message_id: processingMsg.message_id } 
    ); 
  } 
}

// /users command to view active users (admin only)
bot.onText(/\/users/, (msg) => {
  const chatId = msg.chat.id;
  const userData = subscribedUsers.get(chatId);

  if (!userData || !userData.isAdmin) { 
    return bot.sendMessage(chatId, '❌ You do not have permission to use this command'); 
  } 
  
  let userList = `📊 <b>ACTIVATED USERS LIST</b> (${subscribedUsers.size} users)\n\n`; 
  
  subscribedUsers.forEach((userData, id) => { 
    const user = userData.userInfo; 
    userList += `👤 ${user.username ? `@${user.username}` : user.first_name} - ${moment(userData.activatedAt).format('DD/MM HH:mm')}${userData.isAdmin ? ' 👑' : ''}\n`; 
  }); 
  
  bot.sendMessage(chatId, userList, { parse_mode: 'HTML' }); 
});

// --- SCHEDULED INTERVALS ---
const ANALYSIS_INTERVAL = process.env.SCAN_INTERVAL_MS || 2 * 60 * 60 * 1000; // 2 hours default

// Set up intervals
setInterval(runAutoAnalysis, ANALYSIS_INTERVAL);
setInterval(checkDailyGreeting, 60 * 1000); // Check for daily greeting every minute

// Initial analysis after startup
setTimeout(() => { 
  console.log('🚀 Starting initial analysis...');
  runAutoAnalysis(); 
}, 15000);

console.log('🤖 AI Trading Bot V3 is running with ensemble detection...');
console.log(`⏰ Auto analysis every ${ANALYSIS_INTERVAL / 1000 / 60} minutes (04:00 - 23:30)`);
console.log(`🎯 Min confidence: ${process.env.MIN_CONFIDENCE || 60}% | Target coins: ${TARGET_COINS.length}`);
console.log(`👑 Admin IDs: ${ADMIN_IDS.join(', ')}`);
console.log(`💰 Account balance: $${process.env.ACCOUNT_BALANCE || 1000}`);
