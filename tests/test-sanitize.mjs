import { tryEvaluateMath, sanitizeExpression } from '../math-parser.js';

const cases = [
    ['25+1<em>10+12</em>6', 261],
    ['3×4+6÷2', 15],
    ['50％', 0.5],
    ['a＝5；a*2', 10],
    ['（1+2）*3', 9],
    ['１０＋５', 15],
    ['5−3', 2],
    ['2d6＋3', 'range5-15'],
    ['<b>2d6</b>+1', 'range3-13'],
    ['<em>25+1</em>', 26],
];
let pass = 0, fail = 0;
for (const [expr, expected] of cases) {
    const r = tryEvaluateMath(expr);
    if (typeof expected === 'string' && expected.startsWith('range')) {
        const [lo, hi] = expected.slice(5).split('-').map(Number);
        if (r.ok && r.value >= lo && r.value <= hi) pass++;
        else { fail++; console.log(`FAIL ${expr} = ${r.value} (range ${lo}-${hi})`); }
        continue;
    }
    if (r.ok && Math.abs(r.value - expected) < 1e-9) pass++;
    else { fail++; console.log(`FAIL ${expr} = ${r.ok ? r.value : r.error}, expected ${expected}`); }
}
console.log(`sanitize: ${pass}/${pass+fail} passed`);
console.log('sample: 25+1<em>10+12</em>6 →', sanitizeExpression('25+1<em>10+12</em>6'));
