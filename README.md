# MathTools — SillyTavern 数学计算扩展

让角色扮演中的大模型把数学计算交给工具执行,不再靠模型心算出错。

模型(尤其 DeepSeek 系)在 RP 叙事流中即使支持 function calling 也几乎不会主动调用工具,数值全靠心算,经常算错。本扩展用**双机制**确保数值精确:

1. **标记回退机制**(默认开启,**任何后端**都可用,不依赖 function calling)
2. **原生函数工具**(开启酒馆 Function Calling 后注册 `math_evaluate` / `math_execute_code`)

## 功能

- 🎲 **掷骰**:`2d6`、`4d6k3`(掷4取3大)、`d20`、`2d(3+3)`
- 🧮 **数学表达式**:四则、幂 `^`/`**`、取模 `mod`、百分比 `50%`、阶乘 `5!`、变量 `a=5; a*2`
- 📊 **函数**:`sin cos tan sqrt log ln log10 exp abs floor ceil round trunc min max pow random randint gcd lcm comb perm fac`,常量 `pi e tau`
- 💻 **代码执行**:`⟦code⟧...⟦/code⟧` 内写 JavaScript(Web Worker 沙箱,无 DOM/页面数据,超时自动终止;**沙箱内可发起网络请求,不是完全隔离,见下方安全警告**),支持循环/模拟/统计等复杂计算
- 🛡️ **容错**:自动剥离模型混进表达式的 HTML 标签(`<em>` 等)、转换中文符号(`× ÷ － ＋`)、容忍 `165*15=2475` 这类"等式"写法(取左边计算,纠正模型心算的错误结果)
- ⚡ **四层指令注入**:协议放 system 首位 + 计算关键词(骰/伤害/多少/概率等)触发末尾强提醒 + "禁止心算"强制措辞 + **严格模式**(`tool_choice='required'` 每轮强制调工具,适合战斗/经营轮)
- 📋 **计算日志**:设置面板查看每次计算/错误记录,点击可复制

## 安装

### 方式一:酒馆内直接安装(推荐)

1. 打开酒馆 **扩展(Extensions)→ 安装扩展(Install extension)**
2. 粘贴仓库地址:

   ```
   https://github.com/chtcrack/MathTools-SillyTavern-Extension
   ```

3. 选择 **给所有人安装**(全局,所有用户可用)或 **只给我安装**(仅当前用户)
4. 安装完成后刷新页面,设置面板出现在 **扩展 → 🧮 MathTools 数学计算**

> ⚠️ 如果之前手动复制过旧版,安装新版前先删除旧的 `public/scripts/extensions/third-party/MathTools/` 目录,避免新旧两套同时加载。

### 方式二:手动复制

把本仓库目录内全部文件复制到 SillyTavern 的扩展目录:

```
SillyTavern/public/scripts/extensions/third-party/MathTools-SillyTavern-Extension/
```

然后刷新酒馆页面(F5),扩展自动加载。

### 启用原生函数工具(可选)

要让 `math_evaluate` / `math_execute_code` 原生工具生效:进入 **AI 响应配置 → Chat Completion → Function Calling**,勾选启用。标记回退机制不需要这一步。

## ⚠️ 安全警告:不可信第三方 API 端点

本扩展提供 **两个本地代码执行面**,模型输出的代码会在**你的浏览器**里运行:

1. `⟦code⟧...⟦/code⟧` 标记回退(默认开启,任何后端都会执行)
2. 原生函数工具 `math_execute_code`(开启 Function Calling 后生效)

**沙箱能力边界(重要)**:代码在 Web Worker 中执行——没有 DOM,拿不到页面/聊天数据,10 秒超时强制终止。但 Worker 内 **`fetch` / `WebSocket` / `importScripts` 仍然可用**。沙箱**不是完全隔离**:恶意代码可以发起网络请求(fetch 受 CORS 约束,importScripts 不受)、加载外部脚本、或持续占用 CPU。请勿把沙箱当作安全边界。

**风险场景**:使用来路不明的第三方 API 中转站(如匿名论坛分享的免费端点)时,端点运营方可以:

- **静默记录**你发送的全部对话内容(角色卡、世界书、聊天历史)
- 在响应中**注入隐藏指令**,诱导模型输出恶意 `⟦code⟧` 代码或调用 `math_execute_code`
- **篡改模型回复**,诱导你点击钓鱼链接或下载恶意文件

**安全建议**:

- **只连接可信端点**(官方服务或已验证的端点,如 `opencode.ai/zen/go`)
- 必须使用不可信端点时:关闭 **"注册原生函数工具"**,并关闭 **"生成后自动替换标记"**(或至少禁止模型触发 `⟦code⟧` 执行)
- 不要在任何端点上启用 **严格模式**(`tool_choice='required'` 强制每轮调用工具,会放大注入面)——尤其是不可信端点
- 世界书/角色卡中**不要放置真实凭据或个人信息**,它们会随每次请求发送给端点
- 10 秒超时能挡住无限循环,但挡不住**持续诱导**:模型每轮都能被要求输出新的 `⟦code⟧` 代码,不可信端点下请保持警惕

## 使用

什么都不用配,直接 RP。模型涉及计算时会输出:

```
你掷出 ⟦calc⟧2d6+5⟦/calc⟧ 点伤害
```

生成完成后扩展自动计算并替换为绿色高亮结果:

```
你掷出 12 点伤害
```

手动测试(聊天输入框):

```
/math 2d6+5          → 2d6+5 = 12
/mathexec return 6*7 → 42
```

## 设置项

| 设置 | 说明 |
|---|---|
| 注入计算协议提示 | 每轮请求注入"禁止心算"指令(默认开) |
| 生成后自动替换标记 | 计算 ⟦calc⟧/⟦code⟧ 并替换结果(默认开) |
| 注册原生函数工具 | 注册 `math_evaluate` / `math_execute_code`(默认开,需 Function Calling) |
| **严格模式** | `tool_choice='required'` 每轮强制调用工具,战斗/经营轮用;纯对话建议关闭 |
| 关键词强提醒 | 用户消息含"骰/伤害/多少/概率"等词时注入额外提醒(默认开) |
| 代码执行超时 | Web Worker 沙箱执行时限,默认 10 秒 |

## 表达式语法速查

```
算术:    1+2*3  (2+3)*4  2^10  7 mod 3  50% (0.5)  5! (120)
骰子:    2d6  4d6k3  2d6d1  d20  d(6)  2d(3+3)
函数:    sqrt(16)  log10(1000)  comb(52,5)  randint(1,6)  max(3,7,2)
变量:    a = 5; a * 2 + 1
等式:    165*15=2475  (取左边计算,忽略右边)
中文:    3×4+6÷2  （1+2）*3  １０＋５  (自动转 ASCII)
容错:    25+1<em>10+12</em>6  (自动剥离 HTML 标签)
```

## 测试

扩展核心逻辑是纯 JS 模块,可直接用 Node 验证(无需 SillyTavern 环境):

```bash
cd tests
node test-parser.mjs     # 表达式解析器
node test-sanitize.mjs   # 表达式清洗
node test-core.mjs       # 标记替换
node test-inject.mjs     # 指令注入
node test-eq.mjs         # 等式断言
```

## 文件结构

```
MathTools/
├── manifest.json    # 扩展声明(加载器自动引入 js/css)
├── index.js         # 扩展入口:事件绑定/工具注册/斜杠命令/设置面板
├── core.js          # 标记处理 + 指令注入核心(纯逻辑,可测)
├── math-parser.js   # 数学表达式解析器(递归下降,含骰子/清洗)
├── settings.html    # 设置面板模板
├── style.css        # 样式 + 计算结果高亮
└── tests/           # Node 单元测试
```

## License

AGPL-3.0(与 SillyTavern 一致)
