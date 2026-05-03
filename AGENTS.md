# 脚本工具库 - AI Agent 指南

## 项目概述

这是一个用于微博用户采集和筛选的 Node.js 工具库，包含两个主要组件：

| 脚本 | 功能 |
|------|------|
| **weibo-user-filter-v4.js** | 从微博点赞列表采集用户数据，按多维度筛选，导出结果 |
| **telegram-push.js** | 通过 Telegram Bot API 发送消息通知 |

## 快速启动

### 微博用户筛选工具

```bash
# 单个微博采集
node weibo-user-filter-v4.js <微博ID>

# 批量采集（需要 weibo-list.txt）
node weibo-user-filter-v4.js --batch weibo-list.txt
```

**前置要求：**
- 移动端 Cookie（必须，用于采集点赞列表）
- PC Cookie（推荐，用于获取详细用户信息）
- Cookie 格式：JSON 文件 (`mobile-cookies.json`, `cookies.json`)

查看 [完整配置指南](weibo-user-filter/README.md)

### Telegram 推送

```bash
node telegram-push.js "消息内容"
node telegram-push.js --file data.json
```

**环境变量：**
- `TELEGRAM_PUSH_BOT_TOKEN` - Bot 令牌
- `TELEGRAM_PUSH_CHAT_ID` - 目标聊天 ID

## 核心概念

### Cookie 管理
- **mobile-cookies.json**: 微博 m.weibo.cn 的移动端 Cookie（支持多账号）
  - 用途：突破采集 10 页限制，获取更多点赞用户
- **cookies.json**: 微博 weibo.com 的 PC Cookie（支持多账号）
  - 用途：获取用户性别、地区、注册时间、生日等详细信息

### 数据筛选维度
在 `weibo-user-filter-v4.js` 的 CONFIG.FILTERS 中配置：
- `maxFollowers`: 粉丝数上限
- `gender`: 性别 ('f' = 女性)
- `locations`: 地理位置白名单（支持多个）
- `registeredAfter`: 注册时间限制
- `birthdayBefore`: 生日年份限制

### 输出格式
- **CSV 文件**: Excel 可直接打开，包含所有筛选后的用户数据
- **JSON 文件**: 原始数据和筛选结果
- **Telegram 通知**: 采集完成和异常报警

## 关键配置和扩展点

### Telegram 集成
位置：`weibo-user-filter-v4.js` 顶部 CONFIG 对象

```javascript
TELEGRAM: {
  ENABLED: true,                        // 启用/禁用推送
  BOT_TOKEN: process.env.TG_BOT_TOKEN,  // Bot 令牌
  CHAT_ID: process.env.TG_CHAT_ID,      // 结果推送目标
  ALERT_CHAT_ID: process.env.TG_ALERT_CHAT_ID  // 异常报警目标
}
```

### 并发控制
- `MAX_CONCURRENT`: 并发请求数（默认 5）
- `REQUEST_DELAY_MIN/MAX`: 请求延迟范围（毫秒）
- `MAX_RETRIES`: 失败重试次数
- `TIMEOUT`: 单个请求超时（毫秒）

### API 端点
- 点赞列表：`https://m.weibo.cn/api/attitudes/show`
- 用户信息：`https://weibo.com/ajax/profile/info`
- 用户详情：`https://weibo.com/ajax/profile/detail`

## 常见任务

### 添加新筛选条件
编辑 `weibo-user-filter-v4.js` CONFIG.FILTERS 部分，或在脚本解析中实现命令行参数支持。

### 修改输出格式
查看 CSV 导出逻辑（搜索 `fs.writeFileSync(...csv)`）和 JSON 输出结构。

### 调试网络问题
- 启用请求日志：查看 `log()` 调用处
- 检查 Cookie 有效性：手动测试 API 端点
- 查看 Telegram 发送状态：检查报警聊天窗口

### 处理采集失败
脚本会：
1. 自动重试失败的请求（`MAX_RETRIES` 次）
2. 通过 Telegram 发送异常报警（如启用）
3. 记录错误到控制台日志

## 项目结构

```
f:\scripts\
├── telegram-push.js              # Telegram 推送脚本
└── weibo-user-filter/
    ├── weibo-user-filter-v4.js   # 主采集工具（v4 版本含异常报警）
    ├── cookies.json              # PC Cookie 池
    ├── mobile-cookies.json       # 移动端 Cookie 池
    ├── weibo-list.txt            # 批量采集的微博 ID 列表
    ├── output.csv                # 筛选结果（Excel）
    ├── output.json               # 完整数据和统计信息
    └── README.md                 # 详细配置和使用说明
```

## 技术栈

- **运行环境**: Node.js
- **通信**: HTTPS 请求（原生 `https` 模块）
- **数据压缩**: zlib（gzip 支持）
- **并发**: 自定义 `asyncPool()` 实现

## 环境变量参考

| 变量 | 用途 | 来源 |
|------|------|------|
| `TELEGRAM_PUSH_BOT_TOKEN` | telegram-push.js 的 Bot 令牌 | telegram-push.js |
| `TELEGRAM_PUSH_CHAT_ID` | telegram-push.js 的目标聊天 | telegram-push.js |
| `TG_BOT_TOKEN` | weibo-user-filter-v4.js 的 Bot 令牌 | weibo-user-filter-v4.js |
| `TG_CHAT_ID` | 采集结果推送目标 | weibo-user-filter-v4.js |
| `TG_ALERT_CHAT_ID` | 异常报警目标 | weibo-user-filter-v4.js |

## 问题排查

### Cookie 失效
症状：返回 401 或重定向到登录页
解决：重新获取最新的有效 Cookie（见 README.md 配置指南）

### 采集卡顿
症状：请求长时间无响应
解决：
- 增加 REQUEST_DELAY_MIN/MAX
- 减少 MAX_CONCURRENT
- 检查网络连接和 IP 限制

### Telegram 推送失败
症状：日志显示 "Telegram 发送异常"
解决：
- 验证 BOT_TOKEN 和 CHAT_ID 有效性
- 检查网络连接到 Telegram API
- 确保 Bot 有权限向目标聊天发送消息

---

**使用建议：** AI agents 应在执行脚本前验证 Cookie 有效性和网络连接，了解筛选条件配置的位置，并监控 Telegram 通知以了解采集进度。
