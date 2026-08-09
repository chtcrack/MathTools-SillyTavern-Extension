import { tryEvaluateMath } from '../math-parser.js';

const cases = [
    // [表达式, 期望值 | 'range:lo-hi' | 'error']
    ['165*15=2475', 2475],              // 用户遇到的: 等式, 右边正确
    ['165*15=2500', 2475],              // 等式, 右边是模型心算错误值 → 用左边纠正
    ['2+3=5', 5],
    ['2+3=6', 5],                       // 右边错误也被纠正
    ['(17*23+5)/2=198', 198],
    ['2d6+3=?', 'range:5-15'],          // 右边是问号
    ['comb(52,5)=2598960', 2598960],
    ['3×4=12', 12],                     // 中文乘号等式
    ['a=5; a*2=10', 10],                // 赋值 + 等式断言
    ['2d6=7', 'range:2-12'],            // 骰子等式
    ['165*15 = 2475', 2475],            // 带空格
    ['x=10', 10],                       // 纯赋值仍然工作
    ['3 4', 'error'],                   // 无分号连续表达式仍报错
    ['2・5', 'error'],                   // 未知字符仍报错
];
let pass = 0, fail = 0;
for (const [expr, expected] of cases) {
    const r = tryEvaluateMath(expr);
    if (expected === 'error') {
        r.ok ? (fail++, console.log(`FAIL should error: ${expr} = ${r.value}`)) : pass++;
    } else if (typeof expected === 'string' && expected.startsWith('range:')) {
        const [lo, hi] = expected.slice(6).split('-').map(Number);
        r.ok && r.value >= lo && r.value <= hi ? pass++ : (fail++, console.log(`FAIL ${expr} = ${r.ok ? r.value : r.error}`));
    } else {
        r.ok && Math.abs(r.value - expected) < 1e-9 ? pass++ : (fail++, console.log(`FAIL ${expr} = ${r.ok ? r.value : r.error}, expected ${expected}`));
    }
}
console.log(`eq: ${pass}/${pass+fail} passed`);
