# MathTools 对 SillyTavern 核心源码的补丁

本目录存放 MathTools 扩展使用过程中发现并修复的 **SillyTavern 核心 bug** 补丁。
这些改动针对 `SillyTavern/` 本体源码,不属于扩展文件,因此单独归档为可重放的
patch 文件。**SillyTavern 更新(git pull)会覆盖这些改动,更新后需重新应用。**

## 当前补丁

### 0001-fix-unpaired-tool-calls.patch

**文件**: `public/scripts/openai.js`

**Bug**: 函数调用链中,如果工具执行之后、结果写回之前发生中断(API 端点出错、
生成被打断、异常路径),会话历史会残留 `assistant.tool_calls` 却没有对应的
`role:'tool'` 结果消息。OpenAI 兼容上游严格校验 "tool_calls 必须后跟 tool 结果",
于是不仅当轮报 400,之后**每一轮**请求都会被这段残留历史拒绝,形成死循环。

**修复**: 在 `ChatCompletion.getChat()`(发往上游前的最后一个序列化环节)增加
`ensureToolCallPairing()`:自动为缺失结果的 `tool_call_id` 补一条 `role:'tool'`
占位消息(紧跟对应 assistant 之后),保证请求永远配对完整。已污染的会话也会被
自动修复(console 会打印 `[ChatCompletion] 修复未配对 tool_calls`)。

**验证**: 配对逻辑单元测试 6/6;`git apply` 干净应用;语法检查通过。

**应用方法**:

```bash
# 在 SillyTavern 仓库根目录 (扩展通过扩展管理器安装时目录名 = github repo 名)
git apply public/scripts/extensions/third-party/MathTools-SillyTavern-Extension/patches/0001-fix-unpaired-tool-calls.patch
# 或手动复制文件时为
git apply patches/0001-fix-unpaired-tool-calls.patch
```

**如何确认生效**: 重新打开 / 刷新 SillyTavern 页面(前端 ES 模块无需编译)。
console 无 JS 错误;发生未配对时会出现 `修复未配对 tool_calls` 警告。

**重新应用**: SillyTavern 更新到新版本后,先删掉旧补丁残留(如
`ensureToolCallPairing` 报语法错误说明文件已被覆盖),再用 `git apply` 重打。
若上游文件已变化导致 patch 无法干净应用,把新版 openai.js 发给 Hermes 重新适配。
