/**
 * MathTools - 数学表达式解析器
 * 递归下降解析器,支持:
 * - 四则运算 + - * / 、取模 mod、百分比后缀 (50% = 0.5)
 * - 幂 ^ ** (右结合)
 * - 括号、一元负号、阶乘后缀 !
 * - 骰子: 2d6, 3d10+2, 4d6k3 (掷4取3大), 2d6d1 (掷2取1小), d20, d(6), 2d(3+3)
 * - 函数: sin cos tan asin acos atan sinh cosh tanh sqrt cbrt log ln log10 log2 exp abs floor ceil round trunc sign min max pow hypot random randint gcd lcm mod pct fac comb perm
 * - 常量: pi e tau phi
 * - 变量赋值: a = 5; a * 2 (分号分隔)
 * 纯 JS 无依赖, 可在浏览器和 Node 中运行。
 */

const MATH_FUNCTIONS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt,
    log: (x) => Math.log(x), ln: (x) => Math.log(x), log10: Math.log10, log2: Math.log2,
    exp: Math.exp,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    sign: Math.sign,
    min: Math.min, max: Math.max,
    pow: Math.pow, hypot: Math.hypot,
    random: Math.random,
    randint: (a, b) => { const lo = Math.ceil(Math.min(a, b)); const hi = Math.floor(Math.max(a, b)); return Math.floor(Math.random() * (hi - lo + 1)) + lo; },
    gcd: (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; },
    lcm: (a, b) => Math.abs(a * b) / (gcd(a, b) || 1),
    mod: (a, b) => ((a % b) + b) % b,
    pct: (x) => x / 100,
    fac: (n) => { n = Math.trunc(n); if (n < 0) throw new Error('阶乘参数不能为负'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
    comb: (n, k) => { n = Math.trunc(n); k = Math.trunc(k); if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); },
    perm: (n, k) => { n = Math.trunc(n); k = Math.trunc(k); if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r *= (n - i); return r; },
};

const MATH_CONSTANTS = {
    pi: Math.PI, PI: Math.PI, e: Math.E, tau: Math.TAU || Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

const FUNC_NAMES = new Set(Object.keys(MATH_FUNCTIONS));
const CONST_NAMES = new Set(Object.keys(MATH_CONSTANTS));

const DICE_RE = /^(\d+)[dD](\d+)([kKdD])(\d+)/;
const DICE_RE_SIMPLE = /^(\d+)[dD](\d+)/;

class Tokenizer {
    constructor(text) {
        this.text = text;
        this.pos = 0;
        this.tokens = [];
        this.tokenize();
    }

    tokenize() {
        const t = this.text;
        while (this.pos < t.length) {
            const c = t[this.pos];
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { this.pos++; continue; }

            const rest = t.slice(this.pos);

            // 骰子: 2d6, 4d6k3, 2d6d1 (必须是数字紧跟 d/D)
            let m = rest.match(DICE_RE);
            if (m) {
                const keep = m[3].toLowerCase() === 'k';
                this.tokens.push({ type: 'dice', count: parseInt(m[1]), sides: parseInt(m[2]), keepCount: parseInt(m[4]), keepHighest: keep });
                this.pos += m[0].length;
                continue;
            }
            m = rest.match(DICE_RE_SIMPLE);
            if (m) {
                this.tokens.push({ type: 'dice', count: parseInt(m[1]), sides: parseInt(m[2]), keepCount: null, keepHighest: true });
                this.pos += m[0].length;
                continue;
            }

            // 数字
            if (/[0-9.]/.test(c)) {
                const start = this.pos;
                while (this.pos < t.length && /[0-9.eE]/.test(t[this.pos])) this.pos++;
                // 科学计数法: 1e5, 1.5e-3 (e 后允许 +/-)
                if ((t[this.pos] === '+' || t[this.pos] === '-') && /[eE]/.test(t[this.pos - 1] || '')) {
                    this.pos++;
                    while (this.pos < t.length && /[0-9]/.test(t[this.pos])) this.pos++;
                }
                let numStr = t.slice(start, this.pos);
                // 单独 "." 不是数字
                if (numStr === '.') throw new Error(`无法识别的字符: "."`);
                const num = Number(numStr);
                if (isNaN(num)) throw new Error(`无效数字: "${numStr}"`);
                this.tokens.push({ type: 'num', value: num });
                continue;
            }

            // 标识符 (函数/常量/变量/d)
            if (/[a-zA-Z_]/.test(c)) {
                // 特例: 单个 d/D 后面直接跟数字 (如 d20) → 拆成 d + 数字
                if ((c === 'd' || c === 'D') && /[0-9]/.test(t[this.pos + 1] || '')) {
                    this.tokens.push({ type: 'ident', value: c });
                    this.pos++;
                    continue;
                }
                const start = this.pos;
                while (this.pos < t.length && /[a-zA-Z0-9_]/.test(t[this.pos])) this.pos++;
                const ident = t.slice(start, this.pos);
                this.tokens.push({ type: 'ident', value: ident });
                continue;
            }

            // 运算符
            const two = t.slice(this.pos, this.pos + 2);
            if (two === '**') { this.tokens.push({ type: 'pow', value: '**' }); this.pos += 2; continue; }
            if ('+-*/^(),;!= '.includes(c)) {
                this.tokens.push({ type: c, value: c });
                this.pos++;
                continue;
            }
            if (c === '%') { this.tokens.push({ type: '%', value: '%' }); this.pos++; continue; }
            // 无法识别的字符: 生成 unknown token, 由 parser 层决定如何处理 (宽容模式)
            this.tokens.push({ type: 'unknown', value: c });
            this.pos++;
        }
        this.tokens.push({ type: 'eof', value: null });
    }
}

class MathParser {
    /**
     * @param {string} text 表达式文本
     * @param {object} [variables] 外部变量表
     */
    constructor(text, variables = {}) {
        this.tokens = new Tokenizer(text).tokens;
        this.pos = 0;
        this.variables = { ...variables };
    }

    peek() { return this.tokens[this.pos]; }
    next() { return this.tokens[this.pos++]; }
    expect(type) {
        const tok = this.next();
        if (tok.type !== type) throw new Error(`语法错误: 期望 "${type}", 得到 "${tok.value ?? tok.type}"`);
        return tok;
    }

    /** 程序 = 语句 (; 语句)* → 返回最后一个语句的值 (')' 处停止以支持括号内语句) */
    parseProgram() {
        const results = [];
        while (this.peek().type !== 'eof' && this.peek().type !== ')') {
            results.push(this.parseAssignment());
            if (this.peek().type === ';') this.next();
            else if (this.peek().type !== 'eof' && this.peek().type !== ')') throw new Error(`语法错误: 语句之间需要分号, 位置 "${this.peek().value ?? this.peek().type}"`);
        }
        return results.length === 1 ? results[0] : results[results.length - 1];
    }

    /** 赋值 = ident = 表达式 | 表达式 | 等式断言 (expr = 值, 只取左边结果) */
    parseAssignment() {
        if (this.peek().type === 'ident' && this.tokens[this.pos + 1]?.type === '=') {
            const name = this.next().value;
            this.next(); // =
            const value = this.parseExpression();
            this.variables[name] = value;
            return value;
        }
        // 等式断言: 模型常把 "165*15=2475" 整段写进标记, 只取等号左边计算,
        // 右边(可能是模型心算的错误值)忽略 — 正好用精确结果纠正它
        const value = this.parseExpression();
        if (this.peek().type === '=') {
            this.next();
            try {
                this.parseExpression();
            } catch {
                // 右边无法解析(如 "?"、"~"、文字), 跳过直到语句分隔符
                while (!['eof', ';', ')'].includes(this.peek().type)) {
                    this.next();
                }
            }
        }
        return value;
    }

    /** 表达式 = 加法 (支持括号内赋值: (a=3; a+1)) */
    parseExpression() {
        if (this.peek().type === 'ident' && this.tokens[this.pos + 1]?.type === '=') {
            return this.parseAssignment();
        }
        return this.parseAdditive();
    }

    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.peek().type === '+' || this.peek().type === '-') {
            const op = this.next().type;
            const right = this.parseMultiplicative();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    parseMultiplicative() {
        let left = this.parsePower();
        while (true) {
            const tok = this.peek();
            if (tok.type === '*') { this.next(); left = left * this.parsePower(); }
            else if (tok.type === '/') { this.next(); left = left / this.parsePower(); }
            else if (tok.type === 'ident' && tok.value === 'mod') { this.next(); const r = this.parsePower(); left = ((left % r) + r) % r; }
            else if (tok.type === 'ident' && (tok.value === 'd' || tok.value === 'D') && this.tokens[this.pos + 1]?.type === '(') {
                // 括号骰子: 2d(3+3)
                this.next();
                const sides = this.parsePower();
                left = rollDice({ count: left, sides, keepCount: null, keepHighest: true });
            }
            else break;
        }
        return left;
    }

    parsePower() {
        const left = this.parseUnary();
        if (this.peek().type === 'pow' || this.peek().type === '^') {
            this.next();
            const right = this.parsePower(); // 右结合
            return Math.pow(left, right);
        }
        return left;
    }

    parseUnary() {
        if (this.peek().type === '-') { this.next(); return -this.parseUnary(); }
        if (this.peek().type === '+') { this.next(); return this.parseUnary(); }
        const atom = this.parsePostfix();
        // 后缀百分比: 50% = 0.5
        if (this.peek().type === '%') {
            this.next();
            return atom / 100;
        }
        return atom;
    }

    /** 后缀 = 原子 (支持阶乘 !) */
    parsePostfix() {
        let atom = this.parseAtom();
        while (this.peek().type === '!') {
            this.next();
            atom = MATH_FUNCTIONS.fac(atom);
        }
        return atom;
    }

    parseAtom() {
        const tok = this.peek();
        if (tok.type === 'num') { this.next(); return tok.value; }
        if (tok.type === 'dice') {
            this.next();
            return rollDice(tok);
        }
        if (tok.type === 'ident') {
            const name = this.next().value;
            if (this.peek().type === '(') return this.parseFunctionCall(name);
            if (name === 'd' || name === 'D') {
                // 无前缀骰子: d20, d(6)
                if (this.peek().type === 'num') {
                    const sides = this.next().value;
                    if (sides < 1) throw new Error(`骰子面数无效: ${sides}`);
                    return rollDice({ count: 1, sides, keepCount: null, keepHighest: true });
                }
                throw new Error('d 后面需要面数, 如 d20 或 d(6)');
            }
            if (CONST_NAMES.has(name)) return MATH_CONSTANTS[name];
            if (name in this.variables) return this.variables[name];
            if (FUNC_NAMES.has(name)) throw new Error(`函数 ${name} 需要参数括号`);
            throw new Error(`未知标识符: "${name}" (函数: ${[...FUNC_NAMES].join(', ')})`);
        }
        if (tok.type === '(') {
            this.next();
            const value = this.parseProgram(); // 支持括号内语句: (a=3; a+1)
            this.expect(')');
            return value;
        }
        if (tok.type === 'unknown') {
            throw new Error(`无法识别的字符: "${tok.value}"`);
        }
        throw new Error(`意外的标记: "${tok.value ?? tok.type}"`);
    }

    parseFunctionCall(name) {
        this.expect('(');
        const args = [];
        if (this.peek().type !== ')') {
            args.push(this.parseExpression());
            while (this.peek().type === ',') {
                this.next();
                args.push(this.parseExpression());
            }
        }
        this.expect(')');
        if (name === 'd' || name === 'D') {
            if (args.length === 1) return rollDice({ count: 1, sides: args[0], keepCount: null, keepHighest: true });
            if (args.length === 2) return rollDice({ count: args[0], sides: args[1], keepCount: null, keepHighest: true });
            throw new Error('d() 需要 1-2 个参数: d(面数) 或 d(个数, 面数)');
        }
        if (!FUNC_NAMES.has(name)) throw new Error(`未知函数: "${name}"`);
        const fn = MATH_FUNCTIONS[name];
        const arity = fn.length;
        const variadic = ['min', 'max', 'randint'];
        if (arity > 0 && args.length !== arity && !variadic.includes(name)) {
            throw new Error(`函数 ${name} 需要 ${arity} 个参数, 实际 ${args.length} 个`);
        }
        return fn(...args);
    }
}

/** 掷骰子 */
function rollDice(tok) {
    const count = Math.trunc(tok.count);
    const sides = Math.trunc(tok.sides);
    if (count < 1) throw new Error(`骰子个数无效: ${count}`);
    if (sides < 1) throw new Error(`骰子面数无效: ${sides}`);
    if (tok.keepCount !== null) {
        const keep = Math.trunc(tok.keepCount);
        if (keep < 1 || keep > count) throw new Error(`保留个数无效: ${keep} (范围 1-${count})`);
        const rolls = [];
        for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
        rolls.sort((a, b) => tok.keepHighest ? b - a : a - b);
        return rolls.slice(0, keep).reduce((s, v) => s + v, 0);
    }
    let sum = 0;
    for (let i = 0; i < count; i++) sum += 1 + Math.floor(Math.random() * sides);
    return sum;
}

/**
 * 清洗表达式: 剥离 HTML 标签, 转换中文/全角数学符号为 ASCII。
 * 模型在 RP 中常把 <em>/<b> 等强调标签和 ×÷－＋ 等符号混进表达式, 解析前必须清洗。
 * @param {string} expr 原始表达式
 * @returns {string} 清洗后的表达式
 */
export function sanitizeExpression(expr) {
    return String(expr)
        .replace(/<[^>]*>/g, '')          // HTML 标签 (em/strong/b/i 等)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') // 实体
        .replace(/[×✕✖]/g, '*')           // 乘号
        .replace(/[÷]/g, '/')             // 除号
        .replace(/[－−–—]/g, '-')         // 各种减号/破折号
        .replace(/[＋]/g, '+')            // 全角加号
        .replace(/[＝]/g, '=')            // 全角等号
        .replace(/[％]/g, '%')            // 全角百分号
        .replace(/[，]/g, ',').replace(/[；]/g, ';')  // 全角逗号分号
        .replace(/[．]/g, '.')            // 全角句点(小数点)
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角数字
        .replace(/[（]/g, '(').replace(/[）]/g, ')')  // 全角括号
        .replace(/\u00a0/g, ' ')          // NBSP
        .trim();
}

/**
 * 计算数学表达式
 * @param {string} expression 表达式
 * @param {object} [variables] 外部变量
 * @returns {number} 结果
 */
export function evaluateMath(expression, variables = {}) {
    if (typeof expression !== 'string' || !expression.trim()) {
        throw new Error('表达式为空');
    }
    const parser = new MathParser(sanitizeExpression(expression), variables);
    const value = parser.parseProgram();
    if (parser.peek().type !== 'eof') {
        throw new Error(`语法错误: 意外的 "${parser.peek().value ?? parser.peek().type}"`);
    }
    if (!Number.isFinite(value)) {
        throw new Error(`结果无效: ${value}`);
    }
    // 避免浮点误差显示 (7.000000000000001 -> 7)
    return Math.round(value * 1e10) / 1e10;
}

/**
 * 计算表达式并返回人类可读结果
 * @returns {{ ok: boolean, value?: number, text?: string, error?: string, expression: string }}
 */
export function tryEvaluateMath(expression, variables = {}) {
    try {
        const value = evaluateMath(expression, variables);
        return { ok: true, value, text: formatNumber(value), expression };
    } catch (error) {
        return { ok: false, error: error.message || String(error), expression };
    }
}

/** 数字格式化: 整数不带小数, 极大/极小用指数 */
export function formatNumber(value) {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) {
        return value.toExponential(6).replace(/\.?0+e/, 'e');
    }
    return String(Math.round(value * 1e10) / 1e10);
}
