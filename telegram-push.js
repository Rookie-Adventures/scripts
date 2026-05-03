#!/usr/bin/env node
/**
 * Telegram 推送脚本
 * 用法：node telegram-push.js "消息内容"
 * 或：node telegram-push.js --file data.json
 */

const fs = require('fs');
const path = require('path');

// 加载环境变量
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const BOT_TOKEN = process.env.TELEGRAM_PUSH_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_PUSH_CHAT_ID || '8012221336';

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ 错误：缺少 TELEGRAM_PUSH_BOT_TOKEN 或 TELEGRAM_PUSH_CHAT_ID');
  process.exit(1);
}

async function sendMessage(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ 推送成功！');
      return true;
    } else {
      console.error('❌ 推送失败:', result.description);
      return false;
    }
  } catch (error) {
    console.error('❌ 网络错误:', error.message);
    return false;
  }
}

// 主程序
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法:');
    console.log('  node telegram-push.js "消息内容"');
    console.log('  node telegram-push.js --file data.json');
    process.exit(1);
  }
  
  let message;
  
  if (args[0] === '--file' && args[1]) {
    // 从文件读取数据并格式化
    const filePath = path.resolve(args[1]);
    if (!fs.existsSync(filePath)) {
      console.error('❌ 文件不存在:', filePath);
      process.exit(1);
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    message = formatDataMessage(data);
  } else {
    // 直接发送消息
    message = args.join(' ');
  }
  
  await sendMessage(message);
}

function formatDataMessage(data) {
  if (Array.isArray(data)) {
    const count = data.length;
    let text = `<b>📊 数据统计完成</b>\n\n`;
    text += `共找到 <b>${count}</b> 条符合条件的数据\n\n`;
    
    if (count > 0 && count <= 5) {
      text += `<b>详细列表：</b>\n`;
      data.forEach((item, i) => {
        text += `${i + 1}. ${item.screen_name || item.name || '未知用户'}`;
        if (item.location) text += ` (${item.location})`;
        if (item.followers_count !== undefined) text += ` - ${item.followers_count} 粉丝`;
        text += `\n`;
      });
    } else if (count > 5) {
      text += `<i>前 5 条：</i>\n`;
      data.slice(0, 5).forEach((item, i) => {
        text += `${i + 1}. ${item.screen_name || item.name || '未知用户'}\n`;
      });
    }
    
    return text;
  }
  
  return `<b>📊 数据报告</b>\n\n${JSON.stringify(data, null, 2)}`;
}

main();
