#!/usr/bin/env node

/**
 * 微博用户筛选工具 v4.0（报警系统 + 自动清理）
 * 
 * 新增功能：
 * 1. Telegram 异常报警
 * 2. 自动数据清理
 * 3. 任务完成通知
 * 
 * 用法：
 * node weibo-user-filter-v4.js --batch weibo-list.txt [options]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============ 配置 ============
const CONFIG = {
  LIKES_API: 'https://m.weibo.cn/api/attitudes/show',
  PROFILE_API: 'https://weibo.com/ajax/profile/info',
  DETAIL_API: 'https://weibo.com/ajax/profile/detail',
  COOKIE_POOL_PATH: path.join(__dirname, 'pc-ck.json'),
  MOBILE_COOKIE_PATH: path.join(__dirname, 'mobile-ck.json'),
  PERFORMANCE: { MAX_CONCURRENT: 5, REQUEST_DELAY_MIN: 300, REQUEST_DELAY_MAX: 1000, MAX_RETRIES: 3, TIMEOUT: 30000 },
  FILTERS: { maxFollowers: 10, gender: 'f', locations: ['台湾', '新加坡', '香港', '澳大利亚', '新西兰', '日本', '马来西亚'], registeredAfter: new Date('2010-01-01'), birthdayBefore: new Date('1990-01-01'), ipLocations: [] },
  TELEGRAM: { ENABLED: true, BOT_TOKEN: process.env.TG_BOT_TOKEN || '8715953818:AAGgILx6Hway2OooEjZxpD9ENRZ4rd1iLxI', CHAT_ID: process.env.TG_CHAT_ID || '-1003729234221', ALERT_CHAT_ID: process.env.TG_ALERT_CHAT_ID || '-1003729234221' },
  ALERT: { ENABLED: true, ON_ERROR: true, ON_COMPLETE: true, MAX_ERRORS: 3 },
  CLEANUP: { DELETE_RAW: false, DELETE_AFTER_PUSH: false, KEEP_DAYS: 7 }
};

// ============ 请求头配置 ============
const HEADERS = {
  mobile: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://m.weibo.cn/',
    'Origin': 'https://m.weibo.cn',
    'Connection': 'keep-alive',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  },
  pc: (cookie) => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://weibo.com/',
    'Origin': 'https://weibo.com',
    'Connection': 'keep-alive',
    'Cookie': cookie,
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  })
};

// 状态追踪
const STATE = {
  errors: 0,
  startTime: Date.now(),
  processedWeibos: 0,
  qualifiedUsers: 0,
  totalCollected: 0,      // 总采集数
  totalFiltered: 0,       // 初筛通过数
  totalMatched: 0,        // 完全匹配数
  totalReview: 0          // 需要审核数
};

// ============ 日志 ============
function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${ts}] ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseDate(dateStr) { if (!dateStr) return null; try { return new Date(dateStr); } catch (e) { return null; } }

// ============ 并发控制工具函数 ============
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

// ============ Telegram 报警 ============
async function sendTelegramAlert(message, isAlert = false) {
  const chatId = isAlert && CONFIG.TELEGRAM.ALERT_CHAT_ID ? CONFIG.TELEGRAM.ALERT_CHAT_ID : CONFIG.TELEGRAM.CHAT_ID;
  
  if (!CONFIG.TELEGRAM.ENABLED || !CONFIG.TELEGRAM.BOT_TOKEN || !chatId) {
    log('Telegram 未配置，跳过推送', 'WARN');
    return;
  }
  
  if (!message || message.trim().length === 0) {
    log('⚠️ 警告：尝试发送空消息！', 'WARN');
    return;
  }
  
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
  const data = { chat_id: chatId, text: message };
  
  try {
    await new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData, 'utf8') } }, res => {
        let responseData = '';
        res.on('data', c => responseData += c);
        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            result.ok ? resolve(result) : reject(new Error(result.description || 'Unknown error'));
          } catch (e) { 
            // Telegram 返回了非 JSON 数据（如 502 HTML）
            reject(new Error(`Invalid JSON response: ${responseData.substring(0, 100)}`)); 
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Telegram request timeout'));
      });
      req.write(postData, 'utf8');
      req.end();
    });
    log(isAlert ? '🚨 报警发送成功' : '✓ Telegram 发送成功');
  } catch (e) {
    log(`Telegram 发送异常：${e.message}`, 'ERROR');
    // 不抛出异常，防止阻断主程序
  }
}

// 发送错误报警
async function sendErrorAlert(errorType, errorMessage) {
  if (!CONFIG.ALERT.ENABLED || !CONFIG.ALERT.ON_ERROR) return;
  
  const message = `🚨 微博筛选异常报警

任务：微博用户筛选
时间：${new Date().toLocaleString('zh-CN')}
错误类型：${errorType}
错误信息：${errorMessage}

建议：
1. 检查 Cookie 是否过期
2. 检查网络连接
3. 查看日志文件`;

  await sendTelegramAlert(message, true);
}

// 发送完成通知
async function sendCompleteReport() {
  if (!CONFIG.ALERT.ENABLED || !CONFIG.ALERT.ON_COMPLETE) return;
  
  const duration = Math.round((Date.now() - STATE.startTime) / 1000 / 60);
  
  const message = `✅ 微博筛选任务完成

📊 统计数据：
  处理微博：${STATE.processedWeibos} 条
  总采集数：${STATE.totalCollected} 人
  初筛通过：${STATE.totalFiltered} 人（粉丝≤10）
  完全匹配：${STATE.totalMatched} 人
  需要审核：${STATE.totalReview} 人
  
⏱️ 耗时：${duration} 分钟
❌ 错误：${STATE.errors} 次

${STATE.totalMatched > 0 || STATE.totalReview > 0 ? '✅ 合格用户已推送到 Telegram' : '⚠️ 无符合条件用户'}`;

  await sendTelegramAlert(message);
}

// ============ HTTP ============
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers, timeout: CONFIG.PERFORMANCE.TIMEOUT }, res => {
      // 处理 gzip 压缩
      let stream = res;
      const encoding = res.headers['content-encoding'];
      
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }
      
      let data = '';
      stream.on('data', c => data += c);
      stream.on('end', () => { 
        try { 
          resolve(JSON.parse(data)); 
        } catch (e) { 
          resolve({ error: e.message, rawData: data.substring(0, 200) }); 
        } 
      });
      stream.on('error', e => {
        // 清理流
        stream.destroy();
        reject(e);
      });
    });
    
    req.on('error', e => { 
      STATE.errors++; 
      if (STATE.errors >= CONFIG.ALERT.MAX_ERRORS) {
        sendErrorAlert('API 连续失败', e.message); 
      }
      reject(e); 
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// ============ Cookie 池 ============
class CookiePool {
  constructor(cookies = []) { 
    this.cookies = cookies; 
    this.usage = {}; 
    this.idx = 0;
    this.failedCookies = new Set(); // 记录失效的 Cookie
  }
  
  static loadFromFile(p) { 
    try { 
      if (fs.existsSync(p)) { 
        const d = JSON.parse(fs.readFileSync(p)); 
        return new CookiePool(d.cookies || []); 
      } 
    } catch (e) {} 
    return new CookiePool(); 
  }
  
  getCurrent() { 
    if (this.cookies.length === 0) return null;
    // 跳过已失效的 Cookie
    let attempts = 0;
    while (attempts < this.cookies.length) {
      const cookie = this.cookies[this.idx % this.cookies.length];
      if (!this.failedCookies.has(cookie)) {
        return cookie;
      }
      this.idx++;
      attempts++;
    }
    return null; // 所有 Cookie 都失效了
  }
  
  rotate() { 
    this.idx++; 
  }
  
  record() { 
    const c = this.getCurrent(); 
    if (c) this.usage[c] = (this.usage[c] || 0) + 1; 
  }
  
  markFailed(cookie) {
    if (cookie) {
      this.failedCookies.add(cookie);
      log(`⚠️  Cookie 已标记为失效（失效数：${this.failedCookies.size}/${this.cookies.length}）`, 'WARN');
    }
  }
  
  getAvailableCount() {
    return this.cookies.length - this.failedCookies.size;
  }
}

// ============ 核心功能 ============
// 微博短ID转数字ID (Base62解码)
function mid2id(mid) {
  const base62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  
  for (let i = mid.length - 4; i > -4; i -= 4) {
    const offset = i < 0 ? 0 : i;
    const len = i < 0 ? mid.length % 4 || 4 : 4;
    const str = mid.substring(offset, offset + len); // 使用 substring 替代已废弃的 substr
    
    let num = 0;
    for (let j = 0; j < str.length; j++) {
      num = num * 62 + base62.indexOf(str[j]);
    }
    id = num + id;
  }
  
  return id;
}

async function getLikeUsers(weiboId, maxPage = 30, cookiePool = null) {
  log(`📊 获取微博 ${weiboId} 的点赞用户...`);
  
  // 优先使用原始ID（短ID或数字ID都支持）
  // 不再强制转换，让API自己处理
  const useId = weiboId;
  log(`使用ID: ${useId}`);
  
  const all = [];
  for (let p = 1; p <= maxPage; p++) {
    try {
      const url = `${CONFIG.LIKES_API}?id=${useId}&page=${p}`;
      const headers = { ...HEADERS.mobile };
      
      // 如果提供了 Cookie 池，使用当前 Cookie 并轮换
      if (cookiePool && cookiePool.cookies.length > 0) {
        const cookie = cookiePool.getCurrent();
        if (cookie) {
          headers['Cookie'] = cookie;
          cookiePool.record();
          // 每 5 页轮换一次 Cookie，避免单个账号请求过多
          if (p % 5 === 0) {
            cookiePool.rotate();
            log(`🔄 轮换 Cookie（第${p}页，可用：${cookiePool.getAvailableCount()}）`);
          }
        }
      }
      
      const res = await httpGet(url, headers);
      if (res.ok !== 1) {
        log(`第${p}页返回：ok=${res.ok}, msg=${res.msg || ''}, error=${res.error || ''}`, 'WARN');
        if (res.error) log(`详细错误：${JSON.stringify(res).substring(0, 200)}`, 'WARN');
        break;
      }
      const users = res.data?.data || [];
      all.push(...users);
      log(`✓ 第${p}页：${users.length}人`);
      if (users.length < 50) break;
      await sleep(1000);  // 增加到1秒延迟
    } catch (e) { log(`第${p}页失败：${e.message}`, 'ERROR'); break; }
  }
  log(`✅ 共${all.length}人`);
  return all;
}

async function getUserProfile(userId, cookie) {
  if (!cookie) return null;
  try {
    // 并行请求两个接口
    const [infoRes, detailRes] = await Promise.all([
      httpGet(`${CONFIG.PROFILE_API}?uid=${userId}`, HEADERS.pc(cookie)),
      httpGet(`${CONFIG.DETAIL_API}?uid=${userId}`, HEADERS.pc(cookie))
    ]);

    // 更严格的 Cookie 失效检测
    const isInfoExpired = infoRes.retcode === -100 || infoRes.msg === 'not login';
    const isDetailExpired = detailRes.retcode === -100 || detailRes.msg === 'not login';
    
    // 只要有一个接口明确返回未登录，就认为 Cookie 失效
    if (isInfoExpired || isDetailExpired) {
      return { _cookie_expired: true, userId };
    }

    let info = null, detail = null;
    if (infoRes.data && infoRes.data.user) {
      const u = infoRes.data.user;
      info = {
        id: u.id, screen_name: u.screen_name, gender: u.gender, location: u.location,
        followers_count: parseInt(u.followers_count) || 0, friends_count: u.friends_count,
        description: u.description, profile_url: u.profile_url, verified: u.verified
      };
    }
    if (detailRes.data) {
      const d = detailRes.data;
      detail = {
        created_at: d.created_at || null,
        birthday: d.birthday || null,
        ip_location: d.ip_location || null,
        hometown: d.hometown || null
      };
    }

    if (!info && !detail) return null;
    return { ...info, ...detail };
  } catch (e) { return null; }
}

async function getUserDetail(likeUser, cookiePool) {
  const base = { id: likeUser.user.id, screen_name: likeUser.user.screen_name, followers_count: parseInt(likeUser.user.followers_count) || 0 };
  if (!cookiePool || cookiePool.getAvailableCount() === 0) return base;
  
  let attempts = 0;
  // 最多尝试 3 次或池中剩余可用 Cookie 的数量
  const maxAttempts = Math.min(3, cookiePool.getAvailableCount());
  
  while (attempts < maxAttempts) {
    const cookie = cookiePool.getCurrent();
    if (!cookie) break;
    
    const profile = await getUserProfile(likeUser.user.id, cookie);
    
    if (profile && profile._cookie_expired) {
      cookiePool.markFailed(cookie);
      cookiePool.rotate();
      attempts++;
      continue; // 重试下一个
    }
    
    cookiePool.record();
    cookiePool.rotate(); // 轮换实现负载均衡
    return profile || base;
  }
  
  return base; // 所有尝试都失败则返回基础信息
}

// ============ CSV 转换（精简版：用户名 注册时间 地区 生日 粉丝数 用户主页）============
function esc(v) {
  const s = (v || '').toString();
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function convertToCSV(matched, review, weiboId) {
  const headers = ['用户名', '粉丝数', '注册时间', '地区', '生日', '关注数', '用户主页'];
  const rows = [headers.join(',')];
  
  // 第一部分：完全匹配
  if (matched && matched.length > 0) {
    rows.push('# === 完全匹配（所有条件均满足） ===');
    for (const u of matched) {
      rows.push([
        esc(u.screen_name),
        u.followers_count || 0,
        esc((u.created_at || '').slice(0, 10)),
        esc(u.location || u.ip_location || ''),
        esc((u.birthday || '').trim()),
        u.friends_count || 0,
        `https://weibo.com/u/${u.id}`
      ].join(','));
    }
  }
  
  // 第二部分：需要审核
  if (review && review.length > 0) {
    rows.push('');
    rows.push('# === 需要审核（部分信息缺失，留空字段需人工确认） ===');
    for (const u of review) {
      rows.push([
        esc(u.screen_name),
        u.followers_count || 0,
        esc((u.created_at || '').slice(0, 10)),
        esc(u.location || u.ip_location || ''),
        esc((u.birthday || '').trim()),
        u.friends_count || 0,
        `https://weibo.com/u/${u.id}`
      ].join(','));
    }
  }
  
  return '\uFEFF' + rows.join('\n'); // BOM 头，Excel 直接打开不乱码
}

// 旧版兼容（不再使用）
function convertToCSV_old(users) {
  const headers = ['ID', '昵称', '性别', '地区', 'IP属地', '家乡', '粉丝数', '关注数', '注册时间', '生日', '简介', '主页'];
  const rows = [headers.join(',')];
  
  for (const u of users) {
    const row = [
      u.id || '',
      `"${(u.screen_name || '').replace(/"/g, '""')}"`,
      u.gender === 'f' ? '女' : u.gender === 'm' ? '男' : '未知',
      `"${(u.location || '').replace(/"/g, '""')}"`,
      `"${(u.ip_location || '').replace(/"/g, '""')}"`,
      `"${(u.hometown || '').replace(/"/g, '""')}"`,
      u.followers_count || 0,
      u.friends_count || 0,
      u.created_at || '',
      u.birthday || '',
      `"${(u.description || '').replace(/"/g, '""')}"`,
      u.profile_url || ''
    ];
    rows.push(row.join(','));
  }
  
  return rows.join('\n');
}

function convertToTXT(users) {
  const lines = [];
  lines.push('微博筛选结果');
  lines.push('='.repeat(50));
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  lines.push(`共 ${users.length} 人 | ${timeStr}`);
  lines.push('='.repeat(50));
  lines.push('');
  
  users.forEach((u, i) => {
    const gender = u.gender === 'f' ? '女' : u.gender === 'm' ? '男' : '未知';
    const ipClean = (u.ip_location || '').replace('IP属地：', '') || '-';
    const hometownClean = (u.hometown || '').replace('家乡：', '') || '-';
    const regDate = (u.created_at || '').slice(0, 10) || '-';
    const birthday = (u.birthday || '').trim() || '-';
    
    lines.push(`${i+1}. ${u.screen_name || '用户'+u.id}`);
    lines.push(`   性别: ${gender}  |  粉丝: ${u.followers_count || 0}  |  关注: ${u.friends_count || 0}`);
    lines.push(`   地区: ${u.location || '-'}  |  IP属地: ${ipClean}`);
    lines.push(`   家乡: ${hometownClean}  |  生日: ${birthday}`);
    lines.push(`   注册: ${regDate}`);
    lines.push(`   主页: https://weibo.com/u/${u.id}`);
    lines.push('');
  });
  
  lines.push('='.repeat(50));
  lines.push('数据由 OpenClaw 微博筛选工具生成');
  return lines.join('\n');
}

// ============ 筛选 ============
function filterUsers(users, filters) {
  log(`\n🔎 开始筛选（排除法 + 优先级）`, '🔍');
  const filtered = [];
  const stats = { total: users.length, excluded: { male: 0, followers: 0, location: 0, ip_location: 0, registered: 0, birthday: 0 }, passed: { p1: 0, p2: 0, p3: 0 } };
  
  for (const u of users) {
    if (filters.gender === 'f' && u.gender === 'm') { stats.excluded.male++; continue; }
    if (filters.maxFollowers !== undefined && u.followers_count > filters.maxFollowers) { stats.excluded.followers++; continue; }
    
    // 地区筛选（用户填写地区 + IP属地双重检查）
    if (filters.locations && filters.locations.length > 0) {
      if (u.location || u.ip_location) {
        const locMatch = u.location && filters.locations.some(l => u.location.includes(l));
        const ipMatch = u.ip_location && filters.locations.some(l => u.ip_location.includes(l));
        if (!locMatch && !ipMatch) { stats.excluded.location++; continue; }
      }
    }
    
    // IP属地单独筛选
    if (filters.ipLocations && filters.ipLocations.length > 0) {
      if (u.ip_location) {
        const ipMatch = u.ip_location && filters.ipLocations.some(l => u.ip_location.includes(l));
        if (!ipMatch) { stats.excluded.ip_location++; continue; }
      }
    }
    
    // 注册时间筛选
    if (filters.registeredAfter && u.created_at) {
      const regDate = parseDate(u.created_at);
      if (regDate && regDate < filters.registeredAfter) { stats.excluded.registered++; continue; }
    }
    
    // 生日筛选（只对比有完整年份的日期）
    if (filters.birthdayBefore && u.birthday) {
      // 简单的正则匹配：必须包含 4 位年份才做强对比
      if (/^\d{4}/.test(u.birthday.trim())) {
        const birthDate = parseDate(u.birthday);
        if (!birthDate || birthDate >= filters.birthdayBefore) { 
          stats.excluded.birthday++; 
          continue; 
        }
      }
      // 只有月日或星座的，不排除，交由人工审核
    }
    
    const missing = [];
    if (!u.gender && filters.gender) missing.push('性别');
    if (!u.location && !u.ip_location && filters.locations && filters.locations.length > 0) missing.push('地区/IP');
    if (!u.birthday && filters.birthdayBefore) missing.push('生日');
    else if (u.birthday && !/^\d{4}/.test(u.birthday.trim()) && filters.birthdayBefore) missing.push('完整生日');
    if (!u.created_at && filters.registeredAfter) missing.push('注册时间');
    if (!u.ip_location && filters.ipLocations && filters.ipLocations.length > 0) missing.push('IP属地');
    
    const priority = missing.length === 0 ? 1 : missing.length === 1 ? 2 : 3;
    filtered.push({ ...u, priority, missing });
    
    if (priority === 1) stats.passed.p1++;
    else if (priority === 2) stats.passed.p2++;
    else stats.passed.p3++;
  }
  
  filtered.sort((a, b) => a.priority - b.priority);
  log(`📊 原始${stats.total} | 排除：男${stats.excluded.male} 粉超${stats.excluded.followers} 地区${stats.excluded.location} IP${stats.excluded.ip_location} 注册${stats.excluded.registered} 生日${stats.excluded.birthday} | 通过：${filtered.length} (P1${stats.passed.p1} P2${stats.passed.p2} P3${stats.passed.p3})`, '📈');
  return filtered;
}

// ============ Telegram 推送（新版：分类 + 来源链接）============
async function pushToTelegram_v2(matched, review, weiboIds, outputCsv, totalCollected) {
  if (!CONFIG.TELEGRAM.ENABLED || !CONFIG.TELEGRAM.CHAT_ID) return;
  
  log('\n📱 开始 Telegram 推送...', '📱');
  
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN');
  const totalMatched = matched ? matched.length : 0;
  const totalReview = review ? review.length : 0;
  const total = totalMatched + totalReview;
  
  // 构建来源链接
  let sourceLinks = '';
  if (weiboIds && weiboIds.length > 0) {
    sourceLinks = '\n🔗 数据来源：\n' + weiboIds.map((id, i) => `  ${i+1}. https://m.weibo.cn/status/${id}`).join('\n');
  }
  
  let summary = `🦞 微博筛选结果推送\n\n📊 本次采集数量：${totalCollected || 0}\n\n筛选结果\n  ✅ 完全匹配：${totalMatched} 人`;
  if (totalReview > 0) summary += `\n  ⚠️ 信息缺失：${totalReview} 人（需人工审核）`;
  summary += `\n\n📝 筛选条件：粉丝≤${CONFIG.FILTERS.maxFollowers}`;
  if (CONFIG.FILTERS.gender) summary += `\n👤 性别：${CONFIG.FILTERS.gender === 'f' ? '女' : '男'}`;
  if (CONFIG.FILTERS.locations && CONFIG.FILTERS.locations.length > 0) summary += `\n🌍 地区：${CONFIG.FILTERS.locations.join(', ')}`;
  if (CONFIG.FILTERS.registeredAfter) {
    const days = Math.round((now - CONFIG.FILTERS.registeredAfter) / 86400000);
    summary += `\n📅 注册：近${days}天内`;
  }
  if (CONFIG.FILTERS.birthdayBefore) summary += `\n🎂 生日：${CONFIG.FILTERS.birthdayBefore.toISOString().slice(0,4)}年之前`;
  summary += sourceLinks;
  summary += `\n⏰ 时间：${timeStr}`;
  
  await sendTelegramAlert(summary);
  await sleep(500);
  
  // 发送用户名单（完全匹配）
  if (matched && matched.length > 0) {
    let userList = `✅ 完全匹配用户名单（${matched.length}人）\n\n`;
    matched.forEach((u, i) => {
      const name = u.screen_name || `用户${u.id}`;
      const followers = u.followers_count || 0;
      const location = u.location || u.ip_location || '未知';
      const birthday = (u.birthday || '').trim() || '未知';
      userList += `${i+1}. ${name} | 粉丝${followers} | ${location} | ${birthday}\n`;
      userList += `   👤 https://weibo.com/u/${u.id}\n\n`;
    });
    await sendTelegramAlert(userList);
    await sleep(500);
  }
  
  // 发送用户名单（需要审核）
  if (review && review.length > 0) {
    let reviewList = `⚠️ 需要审核用户名单（${review.length}人）\n\n`;
    review.forEach((u, i) => {
      const name = u.screen_name || `用户${u.id}`;
      const followers = u.followers_count || 0;
      const location = u.location || u.ip_location || '未知';
      const birthday = (u.birthday || '').trim() || '未知';
      reviewList += `${i+1}. ${name} | 粉丝${followers} | ${location} | ${birthday}\n`;
      reviewList += `   👤 https://weibo.com/u/${u.id}\n\n`;
    });
    await sendTelegramAlert(reviewList);
    await sleep(500);
  }
  
  if (outputCsv && fs.existsSync(outputCsv)) {
    await sendTelegramFile(outputCsv, `📊 筛选结果（✅${totalMatched} / ⚠️${totalReview}）`);
  }
  
  log(`✅ 推送完成（✅${totalMatched} ⚠️${totalReview}）`, '✅');
}

// 旧版推送（不再使用）
async function pushToTelegram_old(users, outputJson, outputCsv, outputTxt) {
  if (!CONFIG.TELEGRAM.ENABLED || !CONFIG.TELEGRAM.CHAT_ID) return;
  
  log('\n📱 开始 Telegram 推送...', '📱');
  
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const regDays = CONFIG.FILTERS.registeredAfter ? Math.round((now - CONFIG.FILTERS.registeredAfter) / 86400000) : null;
  const regText = regDays ? `注册≤${regDays}天 | ` : '';
  const summary = `🦞 微博筛选结果推送\n\n📊 合格用户：${users.length} 人\n📝 筛选条件：${regText}粉丝≤${CONFIG.FILTERS.maxFollowers}\n🌍 地区：${CONFIG.FILTERS.locations.join(',') || '*'}\n👤 性别：${CONFIG.FILTERS.gender || '*'}\n⏰ 时间：${timeStr}`;
  await sendTelegramAlert(summary);
  await sleep(500);
  
  if (outputTxt && fs.existsSync(outputTxt)) {
    await sendTelegramFile(outputTxt, `📊 完整数据 (${users.length}人)`);
  }
  
  log(`✅ 推送完成（${users.length}人）`, '✅');
}

// 兼容别名
const pushToTelegram = pushToTelegram_v2;

// ============ Telegram 推送（旧版文件发送）============
async function sendTelegramFile(filePath, caption) {
  if (!CONFIG.TELEGRAM.ENABLED || !CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) return;
  
  if (!fs.existsSync(filePath)) {
    log(`⚠️ 文件不存在：${filePath}`, 'WARN');
    return;
  }
  
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendDocument`;
  const boundary = `----FormBoundary${Date.now()}`;
  
  try {
    await new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        }
      }, res => {
        let responseData = '';
        res.on('data', c => responseData += c);
        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            result.ok ? resolve(result) : reject(new Error(result.description));
          } catch (e) { reject(e); }
        });
      });
      
      req.on('error', reject);
      
      // 构建 multipart 数据
      const fileContent = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      
      req.write(`--${boundary}\r\n`);
      req.write(`Content-Disposition: form-data; name="chat_id"\r\n\r\n`);
      req.write(`${CONFIG.TELEGRAM.CHAT_ID}\r\n`);
      req.write(`--${boundary}\r\n`);
      req.write(`Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n`);
      req.write(`Content-Type: application/octet-stream\r\n\r\n`);
      req.write(fileContent);
      req.write(`\r\n--${boundary}\r\n`);
      req.write(`Content-Disposition: form-data; name="caption"\r\n\r\n`);
      req.write(`${caption}\r\n`);
      req.write(`--${boundary}--\r\n`);
      req.end();
    });
    log(`📎 文件发送成功：${path.basename(filePath)}`);
  } catch (e) {
    log(`📎 文件发送失败：${e.message}`, 'ERROR');
  }
}

// 已迁移到 pushToTelegram_v2（上方）

// ============ 数据清理 ============
function cleanupData(weiboId) {
  if (!CONFIG.CLEANUP.DELETE_RAW) return;
  
  log('\n🗑️  开始清理数据...', '🗑️');
  
  const filesToDelete = [
    'weibo-list.txt',
    'weibo-list-detail.json',
    `${weiboId}-detail.json`
  ];
  
  for (const file of filesToDelete) {
    try {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log(`🗑️  已删除：${file}`, '✅');
      }
    } catch (e) { log(`删除失败 ${file}: ${e.message}`, 'ERROR'); }
  }
  
  if (CONFIG.CLEANUP.DELETE_AFTER_PUSH) {
    try {
      ['output.json', 'output.csv'].forEach(file => {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          log(`🗑️  已删除：${file} (推送后)`, '✅');
        }
      });
    } catch (e) { log(`删除输出文件失败：${e.message}`, 'ERROR'); }
  }
}

// ============ 主流程 ============
async function processSingle(weiboId, options, cookiePool) {
  log(`\n📝 处理：${weiboId}`, '📝');
  STATE.processedWeibos++;
  
  // 点赞列表采集使用移动端 Cookie（如果有的话）
  const mobileCookiePool = options.mobileCookiePool;
  if (mobileCookiePool && mobileCookiePool.cookies.length > 0) {
    log(`📱 点赞列表采集：使用移动端 Cookie 池（共 ${mobileCookiePool.cookies.length} 个，可用：${mobileCookiePool.getAvailableCount()}）`);
  } else {
    log(`⚠️  未提供移动端 Cookie，点赞列表将限制在 10 页`, 'WARN');
  }
  
  // 用户详情获取使用 PC 端 Cookie
  if (cookiePool && cookiePool.cookies.length > 0) {
    log(`💻 用户详情获取：使用 PC Cookie 池（共 ${cookiePool.cookies.length} 个，可用：${cookiePool.getAvailableCount()}）`);
  } else {
    log('⚠️  未提供 PC Cookie，将跳过用户详细信息获取', 'WARN');
  }
  
  const likes = await getLikeUsers(weiboId, options.maxPage, mobileCookiePool);
  if (likes.length === 0) { 
    log('⚠️  该微博暂无点赞用户', 'WARN');
    const message = `ℹ️ 微博筛选完成（无点赞数据）

微博：https://m.weibo.cn/status/${weiboId}
时间：${new Date().toLocaleString('zh-CN')}

该微博暂无点赞用户，或需要登录才能查看。

💡 建议：
  - 确认微博 ID 是否正确
  - 尝试其他有更多互动的微博`;
    await sendTelegramAlert(message, false);
    return []; 
  }
  
  const base = likes.filter(u => (parseInt(u.user.followers_count) || 0) <= options.filters.maxFollowers);
  log(`✓ 初筛：${base.length}人（粉丝≤${options.filters.maxFollowers}）`);
  
  // 没有 Cookie 时，直接使用基础信息筛选，跳过详细信息获取
  const hasCookie = cookiePool && cookiePool.cookies.length > 0;
  let details;
  
  if (!hasCookie) {
    log('⚠️  未提供 Cookie，跳过详细信息获取', 'WARN');
    log('提示：使用 --cookie-pool 参数提供 Cookie 可获取性别、地区、注册时间等详细信息');
    
    // 检查是否有需要 Cookie 才能生效的筛选条件
    const needsCookie = (CONFIG.FILTERS.gender && CONFIG.FILTERS.gender !== '*') ||
                        (CONFIG.FILTERS.locations && CONFIG.FILTERS.locations.length > 0) ||
                        (CONFIG.FILTERS.registeredAfter !== null) ||
                        (CONFIG.FILTERS.birthdayBefore !== null) ||
                        (CONFIG.FILTERS.ipLocations && CONFIG.FILTERS.ipLocations.length > 0);
    
    if (needsCookie) {
      const alertMsg = `ℹ️ Cookie 未提供提示

微博：https://m.weibo.cn/status/${weiboId}
时间：${new Date().toLocaleString('zh-CN')}

以下筛选条件因缺少 Cookie 而未生效：
${CONFIG.FILTERS.gender ? '👤 性别: ' + CONFIG.FILTERS.gender : ''}
${CONFIG.FILTERS.locations?.length ? '🌍 地区: ' + CONFIG.FILTERS.locations.join(', ') : ''}
${CONFIG.FILTERS.ipLocations?.length ? '📍 IP属地: ' + CONFIG.FILTERS.ipLocations.join(', ') : ''}
${CONFIG.FILTERS.registeredAfter ? '📅 注册时间: ' + CONFIG.FILTERS.registeredAfter.toISOString().slice(0,10) : ''}
${CONFIG.FILTERS.birthdayBefore ? '🎂 生日: ' + CONFIG.FILTERS.birthdayBefore.toISOString().slice(0,10) : ''}

当前仅使用粉丝数筛选（${base.length} 人）。

💡 如需完整筛选，请运行：
   node get-cookie.js`;
      await sendTelegramAlert(alertMsg, false); // 普通通知，不是报警
    }
    // 直接使用基础信息
    details = base.map(u => ({
      id: u.user.id,
      screen_name: u.user.screen_name,
      followers_count: parseInt(u.user.followers_count) || 0,
      gender: null,
      location: null,
      created_at: null,
      birthday: null,
      friends_count: null,
      description: null,
      profile_url: `https://weibo.com/u/${u.user.id}`,
      verified: false
    }));
  } else {
    // 有 Cookie 时，并发获取详细信息（使用滑动窗口并发控制）
    const availableCookies = cookiePool.getAvailableCount();
    const concurrency = Math.max(1, Math.min(availableCookies * 2, 10)); // 根据可用 Cookie 数量动态调整，最小1最大10
    log(`🔍 开始获取用户详细信息（全局限制并发 ${concurrency}，可用Cookie：${availableCookies}）...`);
    
    let profileFailCount = 0;
    let processedCount = 0;
    
    // 使用 asyncPool 实现滑动窗口并发，避免木桶效应
    details = await asyncPool(concurrency, base, async (u) => {
      // 检查是否还有可用的 Cookie
      if (cookiePool.getAvailableCount() === 0) {
        log(`⚠️  所有 Cookie 均已失效`, 'WARN');
        return {
          id: u.user.id,
          screen_name: u.user.screen_name,
          followers_count: parseInt(u.user.followers_count) || 0,
          gender: null,
          location: null,
          created_at: null,
          birthday: null,
          friends_count: null,
          description: null,
          profile_url: `https://weibo.com/u/${u.user.id}`,
          verified: false
        };
      }
      
      const result = await getUserDetail(u, cookiePool);
      if (result._cookie_expired) profileFailCount++;
      
      processedCount++;
      if (processedCount % 10 === 0) {
        log(`✓ 进度：${processedCount}/${base.length}，可用Cookie：${cookiePool.getAvailableCount()}`);
      }
      
      return result;
    });
    
    // 过滤掉 _cookie_expired 标记
    details = details.filter(r => !r._cookie_expired);
    
    log(`✅ 完成！共获取 ${details.length} 个用户详情`);
    
    // Cookie 失效统计报告
    if (cookiePool.failedCookies.size > 0) {
      const failRate = Math.round(cookiePool.failedCookies.size / cookiePool.cookies.length * 100);
      log(`📊 Cookie 状态：失效 ${cookiePool.failedCookies.size}/${cookiePool.cookies.length} (${failRate}%)`, 'WARN');
      
      if (failRate >= 50) {
        // 高失效率 - 发送报警
        const alertMsg = `🚨 Cookie 失效报警

微博：https://m.weibo.cn/status/${weiboId}
时间：${new Date().toLocaleString('zh-CN')}
失效比例：${cookiePool.failedCookies.size}/${cookiePool.cookies.length} (${failRate}%)

建议：
1. 运行 node get-cookie.js 重新获取 Cookie
2. 或检查 ~/.weibo-filter/cookies.json
3. 确认浏览器中已登录微博`;
        await sendErrorAlert('Cookie 失效', alertMsg);
      }
    }
  }
  
  const filtered = filterUsers(details, options.filters);
  STATE.qualifiedUsers += filtered.length;
  
  // 更新统计数据
  STATE.totalCollected += likes.length;
  STATE.totalFiltered += base.length;
  
  if (filtered.length > 0) {
    // 分成两组：完全匹配 vs 需要审核
    const matched = filtered.filter(u => u.priority === 1);
    const review = filtered.filter(u => u.priority > 1);
    
    // 更新统计
    STATE.totalMatched += matched.length;
    STATE.totalReview += review.length;
    
    const outputJson = options.output || 'output.json';
    const outputCsv = outputJson.replace('.json', '.csv');
    
    // 保存完整 JSON
    fs.writeFileSync(outputJson, JSON.stringify(filtered, null, 2));
    log(`💾 保存到：${outputJson}`);
    
    // 导出 CSV（两个区域）
    const csv = convertToCSV(matched, review, weiboId);
    fs.writeFileSync(outputCsv, csv, 'utf8');
    log(`💾 保存到：${outputCsv}（✅${matched.length} / ⚠️${review.length}）`);
    
    // 推送到 Telegram（新版：分类 + 来源）
    await pushToTelegram(matched, review, [weiboId], outputCsv, likes.length);
  } else {
    log('⚠️  无符合条件用户', 'WARN');
    
    // 发送普通通知（非报警），包含统计信息
    const message = `ℹ️ 微博筛选完成（无符合条件用户）

微博：https://m.weibo.cn/status/${weiboId}
时间：${new Date().toLocaleString('zh-CN')}

📊 筛选统计：
  总采集：${likes.length} 人
  初筛：${base.length} 人（粉丝≤${options.filters.maxFollowers}）
  获取详情：${details.length} 人
  最终通过：0 人

💡 建议：
  - 尝试放宽筛选条件（粉丝数、地区、注册时间等）
  - 或者尝试其他微博帖子`;
    
    await sendTelegramAlert(message, false); // 发送到普通频道，不是报警频道
  }
  
  cleanupData(weiboId);
  return filtered;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = { weiboId: null, batchFile: null, filters: { ...CONFIG.FILTERS }, cookiePool: null, maxPage: 30, output: 'output.json' };
  
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--batch') opt.batchFile = args[++i];
    else if (a === '--max-followers') opt.filters.maxFollowers = parseInt(args[++i]);
    else if (a === '--gender') opt.filters.gender = args[++i];
    else if (a === '--location') opt.filters.locations = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--ip-location') opt.filters.ipLocations = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--registered-after') opt.filters.registeredAfter = new Date(args[++i]);
    else if (a === '--days') { const d = parseInt(args[++i]); const past = new Date(); past.setDate(past.getDate() - d); opt.filters.registeredAfter = past; }
    else if (a === '--birthday-before') opt.filters.birthdayBefore = new Date(args[++i]);
    else if (a === '--cookie-pool') opt.cookiePool = CookiePool.loadFromFile(args[++i]);
    else if (a === '--max-page') opt.maxPage = parseInt(args[++i]);
    else if (a === '--telegram-chat-id') { CONFIG.TELEGRAM.ENABLED = true; CONFIG.TELEGRAM.CHAT_ID = args[++i]; }
    else if (a === '--alert-chat-id') { CONFIG.TELEGRAM.ALERT_CHAT_ID = args[++i]; }
    else if (a === '--no-alert') CONFIG.ALERT.ENABLED = false;
    else if (a === '--no-cleanup') CONFIG.CLEANUP.DELETE_RAW = false;
    else if (!opt.weiboId && !opt.batchFile) opt.weiboId = a;
  }
  
  // 自动加载默认 Cookie 池（如果未通过参数指定）
  // PC Cookie 池（用于用户详情获取）
  if (!opt.cookiePool) {
    const defaultCookiePath = CONFIG.COOKIE_POOL_PATH;
    if (fs.existsSync(defaultCookiePath)) {
      opt.cookiePool = CookiePool.loadFromFile(defaultCookiePath);
      log(`✅ 自动加载 PC Cookie 池：${defaultCookiePath} (${opt.cookiePool.cookies.length} 个)`);
      
      // 检测是否误用了移动端 Cookie
      if (opt.cookiePool.cookies.length > 0) {
        const firstCookie = opt.cookiePool.cookies[0];
        const isMobileCookie = firstCookie.includes('MLOGIN=1') || firstCookie.includes('_T_WM=') || firstCookie.includes('M_WEIBOCN_PARAMS=');
        if (isMobileCookie) {
          log('🚨 警告：PC Cookie 池中包含移动端 Cookie！', 'WARN');
          log('移动端 Cookie 无法获取用户详细信息（性别、地区、注册时间、生日等）', 'WARN');
          log('请从 weibo.com（不是 m.weibo.cn）获取 PC Cookie', 'WARN');
          log('PC Cookie 特征：包含 SUB 和 SUBP，不包含 MLOGIN、_T_WM', 'WARN');
          await sendErrorAlert('Cookie 配置错误', 'PC Cookie 池中包含移动端 Cookie，无法获取用户详细信息');
        }
      }
    }
  }
  
  // 移动端 Cookie 池（用于点赞列表采集）
  if (!opt.mobileCookiePool) {
    const mobileCookiePath = CONFIG.MOBILE_COOKIE_PATH;
    if (fs.existsSync(mobileCookiePath)) {
      opt.mobileCookiePool = CookiePool.loadFromFile(mobileCookiePath);
      log(`✅ 自动加载移动端 Cookie 池：${mobileCookiePath} (${opt.mobileCookiePool.cookies.length} 个)`);
    }
  }
  
  // 自动读取 OpenClaw 配置或环境变量
  // 优先级：命令行参数 > 环境变量 > OpenClaw 配置文件
  if (CONFIG.TELEGRAM.ENABLED && !CONFIG.TELEGRAM.BOT_TOKEN) {
    try {
      const cfg = JSON.parse(fs.readFileSync(require('os').homedir() + '/.openclaw/openclaw.json'));
      if (cfg.channels?.telegram?.botToken) {
        CONFIG.TELEGRAM.BOT_TOKEN = cfg.channels.telegram.botToken;
        if (!CONFIG.TELEGRAM.ALERT_CHAT_ID) CONFIG.TELEGRAM.ALERT_CHAT_ID = cfg.channels.telegram.groups?.['*']?.chatId || cfg.channels.telegram.chatId || CONFIG.TELEGRAM.CHAT_ID;
      }
    } catch (e) {
      log('⚠️  未找到 Telegram 配置，请设置环境变量 TG_BOT_TOKEN 和 TG_CHAT_ID', 'WARN');
    }
  }
  
  log('🦞 微博筛选 v4.0（双接口+IP属地）', '🚀');
  log(`配置：maxFollowers=${opt.filters.maxFollowers}, gender=${opt.filters.gender || '*'}, location=${opt.filters.locations.join(',') || '*'}, ipLocation=${opt.filters.ipLocations?.join(',') || '*'}`);
  if (opt.filters.registeredAfter) {
    const daysAgo = Math.round((Date.now() - opt.filters.registeredAfter.getTime()) / 86400000);
    log(`注册>=${daysAgo}天内, 生日<${opt.filters.birthdayBefore?.toISOString().slice(0,10) || '*'}`);
  } else {
    log(`注册>=*, 生日<${opt.filters.birthdayBefore?.toISOString().slice(0,10) || '*'}`);
  }
  log(`报警：${CONFIG.ALERT.ENABLED ? '✅' : '❌'}, 清理：${CONFIG.CLEANUP.DELETE_RAW ? '✅' : '❌'}`);
  
  try {
    if (opt.batchFile) {
      const ids = fs.readFileSync(opt.batchFile).toString().split('\n').filter(l => l.trim());
      log(`📦 批量：${ids.length}条微博`);
      for (let i = 0; i < ids.length; i++) {
        log(`\n[${i+1}/${ids.length}] ${ids[i]}`);
        await processSingle(ids[i], opt, opt.cookiePool);
      }
    } else if (opt.weiboId) {
      await processSingle(opt.weiboId, opt, opt.cookiePool);
    }
    
    await sendCompleteReport();
    log('\n✅ 任务完成！', '🎉');
  } catch (e) {
    log(`❌ 任务失败：${e.message}`, 'ERROR');
    await sendErrorAlert('任务失败', e.message);
    process.exit(1);
  }
}

main().catch(e => { log(`❌ ${e.message}`, '💥'); process.exit(1); });
