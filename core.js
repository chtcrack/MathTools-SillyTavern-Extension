/**
 * MathTools - 核心逻辑 (不依赖 SillyTavern 环境, 可独立测试)
 * 标记处理: ⟦calc⟧表达式⟦/calc⟧ / ⟦code⟧JS代码⟦/code⟧
 */
import { tryEvaluateMath } from './math-parser.js';

export const CALC_RE = /⟦calc⟧([\s\S]*?)⟦\/calc⟧/g;
export const CODE_RE = /⟦code⟧([\s\S]*?)⟦\/code⟧/g;
export const SEARCH_RE = /⟦search⟧([\s\S]*?)⟦\/search⟧/g;

const HTML_ENTITIES = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** HTML 实体解码 (纯函数, 无 DOM 依赖) */
export function decodeHtml(s) {
    return String(s).replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

/** HTML 转义 */
export function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 触发关键词强提醒的匹配词 (用户消息命中即注入)
export const CALC_KEYWORDS = [
    '骰', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100',
    '伤害', '攻击', '防御', '血量', '生命', '法力', '蓝量',
    '计算', '算一下', '多少', '概率', '百分比', '%',
    '随机', '掷', '加成', '扣除', '消耗', '花费', '价格', '金币',
    'comb', '组合数', '阶乘', '开方', '平方', '幂',
];

/**
 * 向请求 messages 注入 MathTools 指令 (纯函数, 可测试)。
 * @param {Array<{role: string, content: string}>} messages 原始消息数组 (会被修改)
 * @param {object} settings 扩展设置
 * @param {object} [settings.instruction] 完整协议
 * @param {string} [settings.strict_instruction] 严格模式协议
 * @param {string} [settings.keyword_reminder] 关键词提醒
 * @param {boolean} [settings.inject_prompt] 是否注入
 * @param {boolean} [settings.strict_mode] 严格模式
 * @param {boolean} [settings.keyword_boost] 关键词强化
 * @returns {{messages: Array, toolChoice: string|null}} 修改后的消息和 tool_choice
 */
export function injectMathInstructions(messages, settings) {
    let toolChoice = null;

    // 严格模式: 强制每轮调用工具
    if (settings.strict_mode) {
        toolChoice = 'required';
    }

    // 第1层: 完整协议插到 messages 开头 (system 首位, 权重最高; 严格模式用专用指令)
    if (settings.inject_prompt) {
        const instruction = settings.strict_mode ? settings.strict_instruction : settings.instruction;
        if (instruction && instruction.trim()) {
            messages.unshift({
                role: 'system',
                content: instruction,
            });
        }
    }

    // 第2层: 用户消息含计算关键词时, 在末尾注入短提醒 (recency 效应)
    if (settings.keyword_boost && settings.keyword_reminder && settings.keyword_reminder.trim()) {
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
        if (lastUserMessage && CALC_KEYWORDS.some(kw => lastUserMessage.content.includes(kw))) {
            messages.push({
                role: 'system',
                content: settings.keyword_reminder,
            });
        }
    }

    return { messages, toolChoice };
}

/**
 * 处理文本中的所有标记。
 * @param {string} text 原始文本
 * @param {object} deps 依赖注入
 * @param {function(string): Promise<{ok: boolean, result?: string, error?: string}>} deps.executeCode 执行 JS 代码
 * @param {function(string): Promise<{ok: boolean, text?: string, error?: string}>} [deps.search] 网络搜索 (可选, 未提供则 ⟦search⟧ 原样保留)
 * @param {function(string): {ok: boolean, text?: string, error?: string}} [deps.evaluate] 计算表达式
 * @returns {Promise<{text: string, changed: boolean, logs: string[]}>}
 */
export async function processMarkers(text, deps) {
    const { executeCode, evaluate = (expr) => tryEvaluateMath(expr), search } = deps;
    const logs = [];
    let changed = false;

    // 代码块: 逐个处理 (async 不能用于 String.replace 回调; 从后往前替换避免 index 错位)
    let newText = text;
    const codeMatches = [...text.matchAll(CODE_RE)];
    const codeReplacements = [];
    for (const m of codeMatches) {
        const full = m[0];
        const code = m[1];
        const r = await executeCode(code);
        if (r.ok) {
            logs.push(`[代码] ${code.trim().slice(0, 80)} → ${r.result}`);
            changed = true;
            codeReplacements.push({ index: m.index, full, replacement: `**${r.result}**` });
        } else {
            logs.push(`[代码错误] ${code.trim().slice(0, 80)} → ${r.error}`);
            // 失败保留原文, 不污染消息
        }
    }
    for (let i = codeReplacements.length - 1; i >= 0; i--) {
        const { index, full, replacement } = codeReplacements[i];
        newText = newText.slice(0, index) + replacement + newText.slice(index + full.length);
    }

    // 搜索标记 (可选功能, 未启用/未配置 search 时原样保留)
    if (typeof search === 'function') {
        const searchMatches = [...newText.matchAll(SEARCH_RE)];
        const searchReplacements = [];
        for (const m of searchMatches) {
            const query = m[1].trim();
            if (!query) continue;
            const r = await search(query);
            if (r.ok) {
                logs.push(`[搜索] ${query} → ${(r.text || '').slice(0, 80).replace(/\n/g, ' ')}`);
                changed = true;
                searchReplacements.push({ index: m.index, full: m[0], replacement: `🔍 **${r.text}**` });
            } else {
                logs.push(`[搜索失败] ${query} → ${r.error}`);
            }
        }
        for (let i = searchReplacements.length - 1; i >= 0; i--) {
            const { index, full, replacement } = searchReplacements[i];
            newText = newText.slice(0, index) + replacement + newText.slice(index + full.length);
        }
    }

    // 表达式: 同步替换 (解析失败时保留原文, 错误只记日志, 不污染 RP 消息)
    newText = newText.replace(CALC_RE, (match, expr) => {
        const r = evaluate(expr);
        if (r.ok) {
            logs.push(`[计算] ${expr.trim()} = ${r.text}`);
            changed = true;
            return `**${r.text}**`;
        }
        logs.push(`[计算错误] ${expr.trim()} → ${r.error}`);
        return match; // 保留原文
    });

    return { text: newText, changed, logs };
}

/**
 * 处理 DOM 中的标记 (HTML 实体已转义), 结果用高亮 span 包裹。
 * @param {string} html mes_text 的 innerHTML
 * @param {object} deps 同 processMarkers
 * @returns {Promise<string>}
 */
export async function processMarkersDom(html, deps) {
    const { executeCode, evaluate = (expr) => tryEvaluateMath(expr), search } = deps;

    // 代码块 (从后往前替换避免 index 错位)
    let newHtml = html;
    const codeMatches = [...html.matchAll(CODE_RE)];
    const codeReplacements = [];
    for (const m of codeMatches) {
        const full = m[0];
        const decoded = decodeHtml(m[1]);
        const r = await executeCode(decoded);
        if (!r.ok) continue; // 失败保留原文
        codeReplacements.push({ index: m.index, full, replacement: `<span class="mt_result" title="代码">${escapeHtml(r.result)}</span>` });
    }
    for (let i = codeReplacements.length - 1; i >= 0; i--) {
        const { index, full, replacement } = codeReplacements[i];
        newHtml = newHtml.slice(0, index) + replacement + newHtml.slice(index + full.length);
    }

    // 搜索标记 (可选; 与 processMarkers 共用缓存, 不会重复请求)
    if (typeof search === 'function') {
        const searchMatches = [...newHtml.matchAll(SEARCH_RE)];
        const searchReplacements = [];
        for (const m of searchMatches) {
            const query = decodeHtml(m[1]).trim();
            if (!query) continue;
            const r = await search(query);
            if (!r.ok) continue; // 失败保留原文
            searchReplacements.push({ index: m.index, full: m[0], replacement: `<span class="mt_result" title="搜索: ${escapeHtml(query)}">🔍 ${escapeHtml(r.text)}</span>` });
        }
        for (let i = searchReplacements.length - 1; i >= 0; i--) {
            const { index, full, replacement } = searchReplacements[i];
            newHtml = newHtml.slice(0, index) + replacement + newHtml.slice(index + full.length);
        }
    }

    // 表达式: 同步替换 (解析失败时保留原文)
    newHtml = newHtml.replace(CALC_RE, (match, expr) => {
        const decoded = decodeHtml(expr);
        const r = evaluate(decoded);
        if (!r.ok) return match;
        return `<span class="mt_result" title="${escapeHtml(decoded.slice(0, 100))}">${escapeHtml(r.text)}</span>`;
    });
    return newHtml;
}
