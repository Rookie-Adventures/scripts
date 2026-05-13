   // account-manager.js - 增强型 Cookie 提取器
   const { chromium } = require('playwright');
   const fs = require('fs');
   const path = require('path');

   const ACCOUNTS = ['account_1', 'account_2', 'account_3', 'account_4', 'account_5'];
   const OUTPUT_PC = path.join(__dirname, 'pc-ck.json');
   const OUTPUT_MOBILE = path.join(__dirname, 'mobile-ck.json');
   const AUTH_DIR = path.join(__dirname, 'auth_data');

   // 统一使用 PC UA 访问所有端，减少风控
   const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

   if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

   function log(msg, level = 'INFO') {
     const ts = new Date().toISOString().substring(11, 19);
     console.log(`[${ts}] ${level === 'ERROR' ? '❌' : 'ℹ️'} ${msg}`);
   }

   function formatCookieString(cookies) {
     const cookieMap = new Map();
     // 按照值长度排序，确保 SUB 等核心 Cookie 被正确保留
     cookies.sort((a, b) => (b.value || '').length - (a.value || '').length);
     for (const c of cookies) {
       if (!cookieMap.has(c.name)) cookieMap.set(c.name, c.value);
     }
     return Array.from(cookieMap.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
   }

   async function processAccount(accountName) {
     log(`🤖 处理账号: [${accountName}]`);
     const userDataDir = path.join(AUTH_DIR, accountName);
     let context, page;

     try {
       context = await chromium.launchPersistentContext(userDataDir, {
         headless: false, // 开着界面方便扫码和观察
         viewport: { width: 1280, height: 720 },
         userAgent: UA,
         args: ['--disable-blink-features=AutomationControlled']
       });
       page = await context.newPage();
       
       log(`  - 检查 PC 端状态...`);
       await page.goto('https://weibo.com/ajax/profile/info', { timeout: 20000 });
       let content = await page.innerText('body').catch(() => '');
       
       if (!content.includes('"user"') && !content.includes('200000')) {
         log(`  🚨 PC 端未登录，请在弹出的窗口中扫码！`);
         await page.goto('https://weibo.com');
         // 循环等待，直到接口返回正常
         while (true) {
            await new Promise(r => setTimeout(r, 4000));
            try {
              content = await page.evaluate(async () => {
                const res = await fetch('https://weibo.com/ajax/profile/info');
                return await res.text();
              });
              if (content.includes('"user"')) break;
            } catch (e) {}
            log(`  ...等待扫码中...`);
         }
         log(`  ✅ 扫码确认成功！`);
       }

       // 提取 PC Cookie
       const pcCookies = await context.cookies(['https://weibo.com', 'https://passport.weibo.com']);
       const pcStr = formatCookieString(pcCookies);

       log(`  - 同步移动端状态...`);
       const mPage = await context.newPage();
       await mPage.goto('https://m.weibo.cn/', { waitUntil: 'networkidle' });
       await new Promise(r => setTimeout(r, 4000));

       // 如果被跳到了登录页，尝试强行同步一次
       if (mPage.url().includes('login') || mPage.url().includes('passport')) {
         log(`  - 触发跨域同步接口...`);
         await mPage.goto('https://passport.weibo.cn/signin/login?entry=mweibo&r=https%3A%2F%2Fm.weibo.cn%2F');
         await new Promise(r => setTimeout(r, 6000));
       }

       // 最终校验：必须包含 SUB
       const finalCookies = await context.cookies('https://m.weibo.cn');
       const mStr = formatCookieString(finalCookies);

       if (!mStr.includes('SUB=')) {
         log(`  ⚠️ 警告: 移动端 Cookie 提取不完整，可能缺少登录凭证`, 'WARN');
       }

       log(`  ✅ 账号 [${accountName}] 提取完毕。`);
       await new Promise(r => setTimeout(r, 1000));
       await context.close();
       return { pc: pcStr, mobile: mStr };

     } catch (e) {
       log(`  ❌ 异常: ${e.message}`, 'ERROR');
       if (context) await context.close();
       return null;
     }
   }

   async function main() {
     const pcs = [], mob = [];
     for (const acc of ACCOUNTS) {
       const res = await processAccount(acc);
       if (res) { 
         if (res.pc) pcs.push(res.pc);
         if (res.mobile) mob.push(res.mobile);
       }
     }
     
     if (pcs.length > 0) fs.writeFileSync(OUTPUT_PC, JSON.stringify({ cookies: pcs }, null, 2));
     if (mob.length > 0) fs.writeFileSync(OUTPUT_MOBILE, JSON.stringify({ cookies: mob }, null, 2));
     
     log(`🚀 全部处理结束。成功保存 PC: ${pcs.length}, Mobile: ${mob.length}`);
   }

   main().catch(e => console.error(e));
