// MathTools core.js 集成测试 (Node 原生 ESM)
import { processMarkers, processMarkersDom, decodeHtml, escapeHtml } from '../core.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { pass++; }
    else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// 假代码执行器
const fakeExec = async (code) => {
    if (code.includes('return sum')) return { ok: true, result: '5050' };
    if (code.includes('throw')) return { ok: false, error: 'syntax error' };
    return { ok: true, result: 'executed:' + code.trim().slice(0, 20) };
};

// 1. 表达式标记替换
let r = await processMarkers('伤害 = ⟦calc⟧2d6+5⟦/calc⟧ 点', { executeCode: fakeExec });
assert('calc 替换', r.text === '伤害 = **11** 点' || /伤害 = \*\*\d+\*\* 点/.test(r.text), r.text);
assert('calc changed', r.changed === true);
assert('calc log', r.logs.length === 1 && r.logs[0].startsWith('[计算]'));

// 2. 多表达式
r = await processMarkers('a=⟦calc⟧17*23⟦/calc⟧, b=⟦calc⟧(1+2)*3⟦/calc⟧', { executeCode: fakeExec });
assert('多表达式', r.text === 'a=**391**, b=**9**', r.text);

// 3. 代码块替换
r = await processMarkers('结果为 ⟦code⟧let sum=0; for(...) sum+=i; return sum⟦/code⟧ 结束', { executeCode: fakeExec });
assert('code 替换', r.text === '结果为 **5050** 结束', r.text);

// 4. 混合
r = await processMarkers('x=⟦calc⟧5*5⟦/calc⟧, y=⟦code⟧return sum⟦/code⟧', { executeCode: fakeExec });
assert('混合替换', r.text === 'x=**25**, y=**5050**', r.text);

// 5. 代码错误
r = await processMarkers('⟦code⟧throw new Error⟦/code⟧', { executeCode: fakeExec });
assert('代码错误保留原文', r.text === '⟦code⟧throw new Error⟦/code⟧', r.text);
assert('代码错误有日志', r.logs.length === 1 && r.logs[0].includes('syntax error'));

// 6. 表达式错误
r = await processMarkers('⟦calc⟧2d0⟦/calc⟧', { executeCode: fakeExec });
assert('表达式错误保留原文', r.text === '⟦calc⟧2d0⟦/calc⟧', r.text);
assert('表达式错误有日志', r.logs.length === 1 && r.logs[0].includes('骰子面数无效'));

// 7. 无标记不变
r = await processMarkers('普通文本没有计算', { executeCode: fakeExec });
assert('无标记', r.text === '普通文本没有计算' && r.changed === false);

// 8. 连续标记
r = await processMarkers('⟦calc⟧1+1⟦/calc⟧+⟦calc⟧2+2⟦/calc⟧', { executeCode: fakeExec });
assert('连续标记', r.text === '**2**+**4**', r.text);

// 9. DOM 处理 (HTML 实体)
let dom = await processMarkersDom('<p>伤害 = ⟦calc⟧2d6+5⟦/calc⟧ 点</p>', { executeCode: fakeExec });
assert('dom calc span', dom.includes('<span class="mt_result"') && dom.includes('</span>'), dom);
assert('dom calc 数值', /\*\*\d+\*\*/.test('') || dom.match(/mt_result[^>]*>(\d+)</)?.[1] >= 2, dom.slice(0, 120));

// 10. DOM 代码块
dom = await processMarkersDom('<p>⟦code⟧return sum⟦/code⟧</p>', { executeCode: fakeExec });
assert('dom code span', dom.includes('5050'), dom);

// 11. DOM 实体解码 (比较运算 &lt;)
dom = await processMarkersDom('<p>⟦calc⟧1 &lt; 2 ? 5 : 3⟦/calc⟧</p>', { executeCode: fakeExec, evaluate: (e) => ({ ok: false, error: '不支持比较' }) });
assert('dom 实体解码失败保留原文', dom === '<p>⟦calc⟧1 &lt; 2 ? 5 : 3⟦/calc⟧</p>', dom);

// 12. 转义函数
assert('escapeHtml', escapeHtml('<b>&"') === '&lt;b&gt;&amp;&quot;');
assert('decodeHtml', decodeHtml('a &lt; b &amp; c') === 'a < b & c');

// 13. 表达式包含实体 &lt;
r = await processMarkers('⟦calc⟧10 mod 3⟦/calc⟧', { executeCode: fakeExec });
assert('mod 运算', r.text === '**1**', r.text);

// 14. 变量表达式
r = await processMarkers('⟦calc⟧a=5; a*2+1⟦/calc⟧', { executeCode: fakeExec });
assert('变量表达式', r.text === '**11**', r.text);

// 15. 掷骰结果范围
for (let i = 0; i < 50; i++) {
    r = await processMarkers('⟦calc⟧4d6k3⟦/calc⟧', { executeCode: fakeExec });
    const v = parseInt(r.text.replace(/[^\d-]/g, ''));
    if (v < 3 || v > 18) { fail++; console.log(`FAIL dice range: ${v}`); break; }
    if (i === 49) pass++;
}

console.log(`\n${pass}/${pass + fail} passed`);
