   const { chromium } = require('playwright');
   const fs = require('fs');
   const path = require('path');

   // ============ 配置区 ============ 
   // 定义你要管理的账号数量，5 个就写 5 个
   const ACCOUNTS = ['account_1', 'account_2', 'account_3', 'account_4', 'account_5'];

   const OUTPUT_PC = path.join(__dirname, 'pc-ck.json');
   const OUTPUT_MOBILE = path.join(__dirname, 'mobile-ck.json');
   const AUTH_DIR = path.join(__dirname, 'auth_data');

   // 确保存放浏览器状态的文件夹存在
   if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

   function log(msg) {
     const ts = new Date().toISOString().substring(11, 19);
     console.log(`[${ts}] ${msg}`);
   }

   /**
    * 将 Playwright 格式的 Cookie 数组转换为 HTTP Header 需要的字符串格式
    */
   function formatCookieString(cookies) {
     return cookies.map(c => `${c.name}=${c.value}`).join('; ');
   }

   /**
    * 核心逻辑：检查单个账号，如果掉线就弹窗，拿到最新 Cookie 后返回
    */
   async function processAccount(accountName) {
     log(`\n======================================`);
     log(`🤖 开始处理账号: [${accountName}]`);
     
     const userDataDir = path.join(AUTH_DIR, accountName);
     let context, page;
     let isLogged = false;

     try {
       // 1. 先尝试以【无头模式(后台静默)】启动，看看是不是还活着
       log(`  - 后台静默检查状态...`);
       context = await chromium.launchPersistentContext(userDataDir, {
         headless: true, // 后台静默
         viewport: { width: 1280, height: 720 }
       });
       page = await context.newPage();
       await page.goto('https://weibo.com', { timeout: 30000 });

       // 判断：页面里有没有“登录”字样的按钮，或者网址是不是跳到了登录页
       const loginBtnVisible = await page.locator('a[node-type="loginBtn"]').isVisible().catch(() => false);
       const isLoginPage = page.url().includes('passport.weibo.com') || page.url().includes('login');
       
       if (!loginBtnVisible && !isLoginPage) {
         log(`  ✅ 状态正常，账号 [${accountName}] 未掉线。`);
         isLogged = true;
       } else {
         log(`  🚨 账号已掉线！准备唤起图形界面重新登录...`);
       }
       
       // 如果掉线了，必须关闭静默浏览器，换成【带界面】的浏览器让你扫码
       if (!isLogged) {
         await context.close();
         
         log(`  🖥️ 正在弹窗，请在打开的浏览器中【扫码登录】...`);
         // 启动带界面的浏览器
         context = await chromium.launchPersistentContext(userDataDir, {
           headless: false, // 显示界面！
           viewport: { width: 1280, height: 720 },
           args: ['--disable-blink-features=AutomationControlled'] // 防爬虫检测
         });
         page = await context.newPage();
         await page.goto('https://weibo.com');
         
         log(`  ⏳ 等待登录成功... (请勿关闭弹出的浏览器，扫码即可)`);
         
         // 等待 Cookie 里出现 ALF 标志，这是真正登录成功的铁证（游客没有 ALF）
         let checkCount = 0;
         while (!isLogged) {
           await new Promise(r => setTimeout(r, 2000));
           try {
             const currentCookies = await context.cookies();
             const hasALF = currentCookies.some(c => c.name === 'ALF');
             if (hasALF) {
               await new Promise(r => setTimeout(r, 3000)); // 给微博一点时间写入其他关联 Cookie
               isLogged = true;
               log(`  ✅ 扫码成功！捕捉到 ALF 真实身份凭证。`);
             }
           } catch (e) {}
           checkCount++;
           if (checkCount % 15 === 0) log(`  ...还在等你扫码...`);
         }
       }

       // 此时已经必定是登录成功状态了
       log(`  - 正在提取 PC 端 Cookie...`);
       const pcCookiesRaw = await context.cookies('https://weibo.com');
       const pcCookieStr = formatCookieString(pcCookiesRaw);
       
       log(`  - 正在伪装手机访问，提取移动端 Cookie...`);
       // 为了拿到 m.weibo.cn 的 Cookie，我们在这个环境下访问一下手机版网页
       const mobilePage = await context.newPage();
       await mobilePage.goto('https://m.weibo.cn', { timeout: 30000 });
       await new Promise(r => setTimeout(r, 2000)); // 等待数据加载
       const mobileCookiesRaw = await context.cookies('https://m.weibo.cn');
       const mobileCookieStr = formatCookieString(mobileCookiesRaw);
       
       await context.close();
       log(`  🎉 账号 [${accountName}] 处理完毕！`);
       
       return { pc: pcCookieStr, mobile: mobileCookieStr };
       
     } catch (e) {
       log(`  ❌ 账号 [${accountName}] 处理异常: ${e.message}`);
       if (context) await context.close();
       return null;
     }
   }

   /**
    * 汇总结果并写入文件
    */
   async function main() {
     log(`🚀 自动化 Cookie 管家启动！准备检查 ${ACCOUNTS.length} 个账号...`);
     
     const allPcCookies = [];
     const allMobileCookies = [];
     
     // 逐个账号检查过去
     for (const acc of ACCOUNTS) {
       const result = await processAccount(acc);
       if (result) {
         if (result.pc) allPcCookies.push(result.pc);
         if (result.mobile) allMobileCookies.push(result.mobile);
       }
     }
     
     log(`\n======================================`);
     log(`📝 正在将汇总结果写入 JSON 文件...`);
     
     fs.writeFileSync(OUTPUT_PC, JSON.stringify({ cookies: allPcCookies }, null, 2));
     fs.writeFileSync(OUTPUT_MOBILE, JSON.stringify({ cookies: allMobileCookies }, null, 2));
     
     log(`✅ 完美收工！成功保存了 ${allPcCookies.length} 个可用账号凭证！`);
     log(`   PC文件: ${OUTPUT_PC}`);
     log(`   移动文件: ${OUTPUT_MOBILE}`);
     log(`👉 现在您可以安全地运行爬虫脚本了。`);
   }

   main().catch(e => console.error(e));