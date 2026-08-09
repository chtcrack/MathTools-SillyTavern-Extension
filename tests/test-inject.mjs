// MathTools 注入逻辑测试
import { injectMathInstructions } from '../core.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { pass++; }
    else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

const baseSettings = {
    inject_prompt: true,
    strict_mode: false,
    keyword_boost: true,
    instruction: '【强制计算协议】禁止心算...',
    strict_instruction: '【严格模式】必须调用工具...',
    keyword_reminder: '⚠️ 本回合必须用计算标记',
};

// 1. 协议插到开头
let msgs = [
    { role: 'system', content: '角色卡...' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好呀' },
    { role: 'user', content: '我掷个骰子' },
];
let r = injectMathInstructions(msgs, baseSettings);
assert('协议在开头', r.messages[0].role === 'system' && r.messages[0].content.includes('禁止心算'), JSON.stringify(r.messages[0]).slice(0, 60));
assert('无 strict 时 toolChoice null', r.toolChoice === null);

// 2. 关键词命中 → 末尾提醒 (最后一条 user 含"骰")
assert('关键词提醒注入', r.messages[r.messages.length - 1].content.includes('本回合必须用计算标记'), JSON.stringify(r.messages[r.messages.length - 1]).slice(0, 60));
assert('消息总数 6', r.messages.length === 6, String(r.messages.length));

// 3. 无关键词 → 无提醒
let msgs2 = [
    { role: 'user', content: '今天天气不错' },
];
r = injectMathInstructions(msgs2, { ...baseSettings });
assert('无关键词不注入提醒', r.messages.length === 2, String(r.messages.length));
assert('无关键词只有协议', r.messages[1].role === 'user');

// 4. 严格模式 → toolChoice required + strict 指令
r = injectMathInstructions([{ role: 'user', content: '继续' }], { ...baseSettings, strict_mode: true });
assert('strict toolChoice', r.toolChoice === 'required');
assert('strict 指令', r.messages[0].content.includes('严格模式'), r.messages[0].content.slice(0, 30));
assert('strict 无关键词不注入提醒', r.messages[r.messages.length - 1].role === 'user');

// 5. keyword_boost 关闭 → 只有协议
r = injectMathInstructions([{ role: 'user', content: '掷骰' }], { ...baseSettings, keyword_boost: false });
assert('boost 关闭', r.messages.length === 2, String(r.messages.length));

// 6. inject_prompt 关闭 → 什么都不注入
r = injectMathInstructions([{ role: 'user', content: '掷骰' }], { ...baseSettings, inject_prompt: false, keyword_boost: false });
assert('prompt 关闭', r.messages.length === 1 && r.toolChoice === null);

// 7. 最后一条 user 在其他 role 之后
let msgs7 = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'tool', content: 'result' },
    { role: 'user', content: '伤害多少？' },
];
r = injectMathInstructions(msgs7, baseSettings);
assert('tool 消息后找 user', r.messages[r.messages.length - 1].content.includes('本回合必须用计算标记'));

// 8. 修改的是同一数组引用 (不复制)
const arr = [{ role: 'user', content: 'd20 判定' }];
r = injectMathInstructions(arr, baseSettings);
assert('原地修改(协议+user+提醒)', arr.length === 3 && r.messages === arr);

// 9. 关键词大小写/数字组合
r = injectMathInstructions([{ role: 'user', content: '我要 D20 判定' }], baseSettings);
assert('D20 大写命中', r.messages.length === 2);

// 10. 百分比命中
r = injectMathInstructions([{ role: 'user', content: '50% 概率呢' }], baseSettings);
assert('百分比命中(3条)', r.messages.length === 3);

console.log(`\n${pass}/${pass + fail} passed`);
