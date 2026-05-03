# 微博用户筛选工具 - 开发者指南

## 快速参考

### 脚本入口
- **主文件**: `weibo-user-filter-v4.js`
- **执行命令**: `node weibo-user-filter-v4.js <weibo_id> [options]`

### 关键配置对象（脚本顶部）

```javascript
CONFIG = {
  FILTERS: {          // 用户筛选条件
    maxFollowers: 10,           // 粉丝数 ≤ 10
    gender: 'f',                // 仅女性
    locations: [...],           // 地理位置白名单
    registeredAfter: Date,      // 注册时间下限
    birthdayBefore: Date        // 出生年份上限
  },
  TELEGRAM: {...},    // 推送配置（Bot 令牌、目标聊天）
  PERFORMANCE: {...}, // 并发和超时设置
  ALERT: {...}        // 报警策略配置
}
```

### 常见代码位置

| 功能 | 查找关键字 |
|------|-----------|
| 采集点赞列表 | `fetchLikesData()` |
| 获取用户详情 | `fetchUserDetail()` |
| 筛选逻辑 | `filterUser()` |
| CSV 导出 | `writeFileSync(...csv)` |
| Telegram 推送 | `sendTelegramAlert()` |
| 错误处理 | `STATE.errors`, `MAX_RETRIES` |
| 日志输出 | `log()` 函数 |

## 常见修改场景

### 场景 1: 修改筛选条件
```javascript
// 在 CONFIG.FILTERS 中编辑
FILTERS: {
  maxFollowers: 5000,    // 改为 5K 粉丝
  gender: 'm',           // 改为男性
  locations: ['北京', '上海'],  // 改为其他城市
  ...
}
```

### 场景 2: 调整并发性能
```javascript
PERFORMANCE: {
  MAX_CONCURRENT: 10,        // 增加并发（更快但更易被限流）
  REQUEST_DELAY_MIN: 500,    // 增加延迟（避免被封）
  REQUEST_DELAY_MAX: 2000,
  MAX_RETRIES: 5,            // 增加重试次数
  TIMEOUT: 60000             // 增加超时（网络差的环境）
}
```

### 场景 3: 禁用 Telegram（本地开发）
```javascript
TELEGRAM: {
  ENABLED: false,  // 改为 false
  ...
}
```

### 场景 4: 添加自定义筛选逻辑
查找 `filterUser()` 函数，在返回前添加新条件：
```javascript
// 示例：额外过滤粉丝增长率
if (user.followers < user.follows * 0.1) {
  return false;  // 粉丝增长率过低，过滤掉
}
```

## 代码结构

### 主流程（顶部到底部）
1. **配置加载** - 读取 CONFIG、环境变量、Cookie
2. **初始化** - 解析命令行参数，准备 HTTP 请求头
3. **采集** - 调用 `fetchLikesData()` 获取点赞用户列表
4. **详情获取** - 并发调用 `fetchUserDetail()` 获取每个用户信息
5. **筛选** - 应用 `filterUser()` 筛选条件
6. **导出** - 写入 CSV/JSON 文件
7. **推送** - 发送 Telegram 通知
8. **报告** - 输出采集统计信息

### 重要全局变量
- **STATE** - 采集状态追踪（错误数、采集总数、筛选通过数等）
- **CONFIG** - 所有配置项（Cookie 路径、API 端点、筛选条件、Telegram 设置）
- **HEADERS** - HTTP 请求头模板（移动端、PC 端）

## 调试技巧

### 打印调试信息
脚本已有 `log()` 函数：
```javascript
log('你的调试信息', 'INFO');   // 普通日志
log('警告信息', 'WARN');       // 警告
log('错误信息', 'ERROR');      // 错误
```

### 检查 API 响应
在 `fetchUserDetail()` 或 `fetchLikesData()` 中添加：
```javascript
console.log('API 响应:', JSON.stringify(data, null, 2));
```

### 验证 Cookie
手动访问 API 端点并检查是否返回数据：
```bash
curl -H "Cookie: [你的Cookie]" "https://m.weibo.cn/api/attitudes/show?..."
```

## 数据流向

```
weibo-list.txt（微博 ID 列表）
    ↓
fetchLikesData()（点赞用户采集）
    ↓
并发 fetchUserDetail()（用户详情获取）
    ↓
filterUser()（应用筛选条件）
    ↓
output.json + output.csv（导出）
    ↓
sendTelegramAlert()（推送通知）
```

## 导出数据格式

### CSV 文件 (output.csv)
- 包含所有筛选通过的用户
- 字段：uid, name, followers, gender, location, registerTime, birthday 等
- 可直接用 Excel 打开

### JSON 文件 (output.json)
```json
{
  "meta": {
    "weiboId": "5286218461086733",
    "startTime": "2026-04-30T10:00:00Z",
    "duration": 120000,
    "statistics": {
      "totalCollected": 1500,
      "totalFiltered": 150,
      "totalMatched": 50,
      "totalReview": 100
    }
  },
  "qualified": [...],  // 完全匹配的用户
  "review": [...]      // 需要人工审核的用户
}
```

## 常见错误和解决

| 错误 | 原因 | 解决方案 |
|------|------|--------|
| `Cannot find cookies.json` | Cookie 文件不存在 | 按 README 配置 Cookie 文件位置 |
| `401 Unauthorized` | Cookie 过期或无效 | 重新获取新的有效 Cookie |
| `ECONNREFUSED` | 网络问题或被 IP 限制 | 增加延迟，减少并发，换 IP |
| `Telegram 发送异常` | Bot 令牌或聊天 ID 无效 | 验证环境变量配置 |
| `Max call stack exceeded` | 递归过深 | 减少 MAX_CONCURRENT 并发数 |

## 版本历史注记

- **v4.0**：增加 Telegram 异常报警、自动数据清理、任务完成通知

---

**提示**：修改脚本后，先在本地测试一个小规模微博（如 5 页数据）来验证改动，再进行大规模采集。
