# 微博用户筛选工具 - 使用说明

## 核心功能

从微博点赞用户中筛选符合条件的用户，支持：
- 采集 30+ 页点赞用户（1500+ 人）
- 按粉丝数、性别、地区、注册时间、生日筛选
- 自动推送结果到 Telegram
- 导出 CSV 文件（Excel 可直接打开）

## 重要说明

**必须配置移动端 Cookie 才能突破 10 页限制！**

- 无移动端 Cookie：只能采集 10 页（500 人）
- 有移动端 Cookie：可以采集 30+ 页（1500+ 人）

## 快速开始

### 1. 配置 Cookie

脚本需要两种 Cookie：

#### 移动端 Cookie（必需）
用于采集点赞列表，突破 10 页限制

**获取方法：**
1. Chrome 浏览器按 `F12` 打开开发者工具
2. 按 `Ctrl+Shift+M` 切换到移动模式（或点击 📱 图标）
3. 访问 `https://m.weibo.cn` 并登录
4. 在 Network 标签中找到任意请求
5. 右键 → Copy → Copy request headers
6. 找到 `Cookie:` 字段，复制完整内容

**保存位置：**
```
C:\Users\USER\.weibo-filter\mobile-cookies.json
```

**文件格式：**
```json
{
  "cookies": [
    "XSRF-TOKEN=xxx;SUBP=xxx;MLOGIN=1;SUB=xxx;ALF=xxx;_T_WM=xxx;M_WEIBOCN_PARAMS=xxx;mweibo_short_token=xxx;SCF=xxx;SSOLoginState=xxx;WEIBOCN_FROM=xxx",
    "第二个账号的移动端Cookie",
    "第三个账号的移动端Cookie"
  ]
}
```

**推荐数量：** 3-5 个

#### PC Cookie（推荐）
用于获取用户详细信息（性别、地区、注册时间、生日等）

**获取方法：**
1. Chrome 浏览器（正常模式）
2. 访问 `https://weibo.com` 并登录
3. 按 `F12` 打开开发者工具
4. 在 Network 标签中找到任意请求
5. 右键 → Copy → Copy request headers
6. 找到 `Cookie:` 字段，复制完整内容

**保存位置：**
```
C:\Users\USER\.weibo-filter\cookies.json
```

**文件格式：**
```json
{
  "cookies": [
    "XSRF-TOKEN=xxx;SUB=xxx;SUBP=xxx;...",
    "第二个账号的PC Cookie",
    "第三个账号的PC Cookie",
    "第四个账号的PC Cookie"
  ]
}
```

**推荐数量：** 3-5 个

### 2. 运行脚本

#### 单个微博采集

```bash
node weibo-user-filter-v4.js <微博ID>
```

示例：
```bash
node weibo-user-filter-v4.js 5286218461086733
```

#### 批量采集

1. 创建 `weibo-list.txt`，每行一个微博 ID：
```
5286218461086733
5285748481197168
5286040802689438
```

2. 运行批量采集：
```bash
node weibo-user-filter-v4.js --batch weibo-list.txt
```

## 命令行参数

### 基本参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--batch <文件>` | 批量采集 | `--batch weibo-list.txt` |
| `--max-page <数量>` | 采集页数（默认 30） | `--max-page 20` |

### 筛选条件

| 参数 | 说明 | 默认值 | 示例 |
|------|------|--------|------|
| `--max-followers <数量>` | 粉丝数上限 | 10 | `--max-followers 20` |
| `--gender <性别>` | 性别（f/m） | f | `--gender f` |
| `--location <地区>` | 地区列表（逗号分隔） | 台湾,新加坡,香港,澳大利亚,新西兰,日本,马来西亚 | `--location "台湾,日本"` |
| `--days <天数>` | 注册时间（最近N天） | 15 | `--days 30` |
| `--birthday-before <日期>` | 生日早于 | 1990-01-01 | `--birthday-before "1995-01-01"` |

### 示例

```bash
# 采集 20 页，粉丝≤20，最近 30 天注册
node weibo-user-filter-v4.js 5286218461086733 --max-page 20 --max-followers 20 --days 30

# 批量采集，修改地区筛选
node weibo-user-filter-v4.js --batch weibo-list.txt --location "台湾,日本,韩国"
```

## 输出文件

每次运行生成：

### output.csv
Excel 可直接打开，包含两部分：

**完全匹配**：所有条件都满足的用户
- 用户名
- 粉丝数
- 注册时间
- 地区
- 生日
- 关注数
- 用户主页

**需要审核**：部分信息缺失的用户（需人工确认）

### output.json
完整的用户数据（JSON 格式）

## Telegram 推送

脚本会自动推送结果到 Telegram：

1. **筛选摘要**
   - 本次采集数量
   - 筛选结果统计
   - 筛选条件
   - 数据来源链接

2. **用户名单**
   - 完全匹配用户列表（带主页链接）
   - 需要审核用户列表（带主页链接）

3. **CSV 文件**
   - 完整的筛选结果文件

## Cookie 轮换机制

脚本自动轮换 Cookie，避免单个账号请求过多：

### 点赞列表采集（移动端 Cookie）
- 每 5 页轮换一次
- 例如：第 1-5 页用 Cookie #1，第 6-10 页用 Cookie #2

### 用户详情获取（PC Cookie）
- 每次请求后立即轮换
- 实现负载均衡

### 日志示例

```
✅ 自动加载 PC Cookie 池：C:\Users\USER\.weibo-filter\cookies.json (4 个)
✅ 自动加载移动端 Cookie 池：C:\Users\USER\.weibo-filter\mobile-cookies.json (3 个)
📱 点赞列表采集：使用移动端 Cookie 池（共 3 个，可用：3）
💻 用户详情获取：使用 PC Cookie 池（共 4 个，可用：4）
📊 获取微博 5286218461086733 的点赞用户...
✓ 第1页：50人
✓ 第2页：50人
...
✓ 第10页：50人
✓ 第11页：50人  ← 突破 10 页限制！
✓ 第12页：50人
...
🔄 轮换 Cookie（第5页，可用：3）
```

## 常见问题

### Q1: 只能采集 10 页（500 人）？

**A:** 需要配置移动端 Cookie。

检查：
1. 文件是否存在：`C:\Users\USER\.weibo-filter\mobile-cookies.json`
2. Cookie 是否从 `m.weibo.cn` 获取（不是 `weibo.com`）
3. Cookie 中是否包含 `MLOGIN=1` 和 `_T_WM` 字段

### Q2: 移动端 Cookie 和 PC Cookie 有什么区别？

**A:**
- **移动端 Cookie**：用于采集点赞列表，可以突破 10 页限制
- **PC Cookie**：用于获取用户详细信息（性别、地区、注册时间等）

### Q3: 可以只用移动端 Cookie 吗？

**A:** 可以，但不推荐。PC Cookie 可以获取更完整的用户信息，提高筛选准确性。

### Q4: Cookie 多久过期？

**A:** 通常 7-30 天。建议：
- 定期（每周）更新一次
- 准备 3-5 个备用账号
- 使用小号，不要用主账号

### Q5: 如何获取微博 ID？

**A:** 从微博链接中提取：

PC 端链接：
```
https://weibo.com/1228969975/QzLjLy4YP
                              ^^^^^^^^^ 这是 ID
```

移动端链接：
```
https://m.weibo.cn/status/5285233738122299
                          ^^^^^^^^^^^^^^^^ 这是 ID
```

两种格式都支持！

### Q6: 筛选结果为 0？

**A:** 可能原因：
1. 筛选条件太严格（尝试放宽条件）
2. 该微博的点赞用户不符合条件
3. Cookie 过期（重新获取）

建议：
- 增加粉丝数上限：`--max-followers 20`
- 延长注册时间：`--days 30`
- 扩大地区范围：`--location "台湾,日本,韩国,新加坡"`

## 技术细节

### Cookie 特征识别

**移动端 Cookie 必须包含：**
```
MLOGIN=1              ← 移动端登录标识
_T_WM=xxx             ← 移动端 Token（关键）
M_WEIBOCN_PARAMS=xxx  ← 移动端参数（关键）
WEIBOCN_FROM=xxx      ← 来源标识
```

**PC Cookie 必须包含：**
```
SUB=xxx               ← 用户标识（关键）
SUBP=xxx              ← 用户权限（关键）
XSRF-TOKEN=xxx        ← 安全令牌
```

### 采集流程

```
1. 点赞列表采集（使用移动端 Cookie）
   ├─ API: m.weibo.cn/api/attitudes/show
   ├─ 可以采集 30+ 页（1500+ 人）
   └─ 每 5 页轮换一次 Cookie

2. 用户详情获取（使用 PC Cookie）
   ├─ API: weibo.com/ajax/profile/info
   ├─ 获取性别、地区、注册时间、生日等
   └─ 每次请求后轮换 Cookie

3. 筛选和导出
   ├─ 按条件筛选用户
   ├─ 生成 CSV 和 JSON 文件
   └─ 推送到 Telegram
```

## 文件结构

```
weibo-user-filter/
├── weibo-user-filter-v4.js    # 主脚本
├── weibo-list.txt              # 微博 ID 列表（批量采集用）
└── README.md                   # 本说明文档

C:\Users\USER\.weibo-filter/
├── mobile-cookies.json         # 移动端 Cookie 配置
└── cookies.json                # PC Cookie 配置
```

## 注意事项

1. **Cookie 安全**
   - 不要分享 Cookie（等同于账号密码）
   - 使用小号，不要用主账号
   - 定期更换 Cookie

2. **请求频率**
   - 即使有多个 Cookie，也要控制总请求频率
   - 不要短时间内大量采集

3. **数据备份**
   - 定期备份 `C:\Users\USER\.weibo-filter\` 目录
   - 保存重要的筛选结果

4. **账号安全**
   - 不要在公共场所使用这些账号
   - 避免异常登录行为

## 更新日志

### v4.0
- ✅ 支持双 Cookie 池（移动端 + PC）
- ✅ 突破 10 页限制，可采集 30+ 页
- ✅ Cookie 自动轮换机制
- ✅ Telegram 推送优化
- ✅ CSV 导出优化

---

**如有问题，请检查日志输出定位问题。**
