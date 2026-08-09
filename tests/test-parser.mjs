import { evaluateMath, tryEvaluateMath, formatNumber } from '../math-parser.js';

const cases = [
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['2^10', 1024],
    ['2**10', 1024],
    ['2^3^2', 512],
    ['-5+3', -2],
    ['10/4', 2.5],
    ['50%', 0.5],
    ['200*50%', 100],
    ['10 mod 3', 1],
    ['sqrt(16)', 4],
    ['2^0.5', Math.sqrt(2)],
    ['pi', Math.PI],
    ['round(2.5)', 3],
    ['floor(2.9)', 2],
    ['max(3,7,2)', 7],
    ['min(3,7,2)', 2],
    ['comb(52,5)', 2598960],
    ['perm(10,3)', 720],
    ['5!', 120],
    ['3!+2', 8],
    ['a = 5; a * 2', 10],
    ['(a=3; a+1) * 2', 8],
    ['2d6', null],  // random, check range
    ['4d6k3', null], // check range 3-18
    ['d20', null], // 1-20
    ['d(6)', null],
    ['2d(3+3)', null],
    ['3d10+2', null],
    ['1e3', 1000],
    ['1.5e-3', 0.0015],
    ['log10(1000)', 3],
    ['randint(1,6)', null],
    ['0.1+0.2', 0.3],
];

let pass = 0, fail = 0;
for (const [expr, expected] of cases) {
    const r = tryEvaluateMath(expr);
    if (r.ok) {
        if (expected === null) {
            // range check
            if (expr.includes('2d6')) {
                const ok = r.value >= 2 && r.value <= 12;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else if (expr.includes('4d6k3')) {
                const ok = r.value >= 3 && r.value <= 18;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else if (expr.includes('d20') || expr.includes('d(6)')) {
                const ok = r.value >= 1 && r.value <= 20;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else if (expr.includes('2d(3+3)')) {
                const ok = r.value >= 2 && r.value <= 12;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else if (expr.includes('3d10+2')) {
                const ok = r.value >= 5 && r.value <= 32;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else if (expr.includes('randint')) {
                const ok = r.value >= 1 && r.value <= 6;
                ok ? pass++ : (fail++, console.log(`FAIL range ${expr} = ${r.value}`));
            } else {
                pass++;
            }
        } else {
            if (Math.abs(r.value - expected) < 1e-9) { pass++; }
            else { fail++; console.log(`FAIL ${expr} = ${r.value}, expected ${expected}`); }
        }
    } else {
        fail++;
        console.log(`ERROR ${expr}: ${r.error}`);
    }
}

// error cases
const errCases = ['2d0', '2d', 'sqrt()', 'foo(3)', '1+', '3 4', 'x'];
for (const expr of errCases) {
    const r = tryEvaluateMath(expr);
    if (!r.ok) { pass++; console.log(`OK error case "${expr}": ${r.error.slice(0,60)}`); }
    else { fail++; console.log(`FAIL should error: ${expr} = ${r.value}`); }
}

// code execution simulation (worker body)
const codeStr = 'let sum = 0; for (let i = 1; i <= 100; i++) sum += i; return sum;';
const codeFn = new Function(`return (async () => { ${codeStr} })();`);
const codeResult = await codeFn();
if (codeResult === 5050) { pass++; } else { fail++; console.log('FAIL code exec:', codeResult); }

console.log(`\n${pass}/${pass+fail} passed`);
