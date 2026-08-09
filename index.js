/**
 * MathTools - 数学计算工具扩展
 * 让大模型在角色扮演中遇到数学计算时调用工具/编写代码,而不是心算出错。
 *
 * 双机制:
 * 1. 标记回退机制(默认开启, 任何后端可用):
 *    - 注入系统提示, 教模型用 ⟦calc⟧表达式⟦/calc⟧ / ⟦code⟧JS代码⟦/code⟧ 标记
 *    - 生成完成后自动计算并替换为精确结果, 保存进聊天
 * 2. 原生函数工具(需在酒馆开启 Function Calling):
 *    - math_evaluate: 数学表达式计算
 *    - math_execute_code: 沙箱 JS 代码执行 (Web Worker, 无 DOM/网络)
 */
import { eventSource, event_types, chat, saveChatConditional } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { ToolManager } from '../../../tool-calling.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { tryEvaluateMath } from './math-parser.js';
import { processMarkers, processMarkersDom, escapeHtml, injectMathInstructions } from './core.js';

const extensionName = 'MathTools';

// 从 import.meta.url 动态推导扩展目录 (适配任意安装目录名, 如 third-party/MathTools 或 third-party/MathTools-SillyTavern-Extension)
const scriptPath = typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : '';
const pathMatch = scriptPath.match(/scripts\/extensions\/(.+)\/index\.js/);
const extensionFolderPath = pathMatch ? pathMatch[1] : 'third-party/MathTools';

const defaultSettings = {
    inject_prompt: true,        // 注入计算协议提示
    replace_markers: true,      // 替换计算标记
    native_tools: true,         // 注册原生函数工具
    strict_mode: false,         // 严格模式: 每轮强制调用工具 (tool_choice=required)
    keyword_boost: true,        // 用户消息含计算关键词时注入强提醒
    code_timeout: 10000,        // 代码执行超时 ms
    instruction: [
        '【强制计算协议 - MathTools】你被系统禁止心算任何数值。',
        '规则: 回复中需要任何数值结果时(掷骰、伤害、攻击、价格、概率、统计、换算、加减乘除),你必须把计算表达式放进 ⟦calc⟧表达式⟦/calc⟧,复杂逻辑放进 ⟦code⟧JavaScript代码(return返回)⟦/code⟧,扩展会自动计算并替换为精确结果。',
        '禁止事项: ①禁止直接输出未经标记的心算数字——心算结果会被判定为幻觉错误; ②禁止把骰子结果写成"骰子显示X点"而不给出 ⟦calc⟧ 标记; ③⟦calc⟧ 内只放纯数学表达式(数字/运算符/括号/函数),禁止包含任何文字、单位或 <em>/<b> 等格式标签。',
        '表达式: + - * / mod 幂^ 括号; 骰子 2d6、4d6k3(掷4取3大)、d20、d(6); 函数 sin cos tan sqrt log ln log10 exp abs floor ceil round trunc min max pow random randint gcd lcm comb perm fac; 常量 pi e; 变量 a=5; a*2; 50%=0.5。',
        '示例: "你掷出 ⟦calc⟧2d6+3⟦/calc⟧ 点伤害" → 扩展替换为 "你掷出 12 点伤害"。',
    ].join('\n'),
    keyword_reminder: [
        '⚠️【本回合计算提醒】本回合用户消息包含数值计算需求。你必须使用 ⟦calc⟧表达式⟦/calc⟧ 标记(或调用 math_evaluate/math_execute_code 工具)完成计算,禁止直接输出心算数字。',
    ].join('\n'),
    strict_instruction: [
        '【严格模式 - MathTools】系统强制要求你每次回复必须调用数学工具,禁止心算。',
        '规则: ①涉及任何数值(掷骰、伤害、攻击、价格、概率、统计、换算)时, 必须调用 math_evaluate 计算表达式或 math_execute_code 执行代码, 禁止直接输出数字; ②如果本轮回复没有数值计算需求, 调用 math_execute_code 并 return "no_calc_required"; ③工具返回结果后, 在正文中使用工具的精确结果, 且正文中不再重复输出计算过程标记。',
    ].join('\n'),
};

// 运行时状态
const calcLog = [];
let settings = null;

/** 从扩展设置读取配置 */
function loadSettings() {
    settings = Object.assign({}, defaultSettings, extension_settings[extensionName] || {});
}

/* ==================== 沙箱代码执行 (Web Worker) ==================== */

/**
 * 在 Web Worker 沙箱中执行 JS 代码 (无 DOM/无 window, 可超时终止)。
 * @param {string} code 代码, 用 return 返回结果
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<{ok: boolean, result?: string, error?: string}>}
 */
function executeCodeSandbox(code, timeoutMs = 10000) {
    return new Promise((resolve) => {
        let worker;
        let url;
        try {
            const workerSource = `
                self.onmessage = async (e) => {
                    try {
                        const result = await (async () => {
                            ${code}
                        })();
                        self.postMessage({ ok: true, result: serialize(result) });
                    } catch (err) {
                        self.postMessage({ ok: false, error: String(err && err.stack ? err.stack : err) });
                    }
                };
                function serialize(v) {
                    if (v === null || v === undefined) return String(v);
                    const t = typeof v;
                    if (t === 'object') {
                        try { return JSON.stringify(v); } catch { return String(v); }
                    }
                    return String(v);
                }
            `;
            const blob = new Blob([workerSource], { type: 'application/javascript' });
            url = URL.createObjectURL(blob);
            worker = new Worker(url);
            const timer = setTimeout(() => {
                worker.terminate();
                URL.revokeObjectURL(url);
                resolve({ ok: false, error: `代码执行超时(${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);
            worker.onmessage = (e) => {
                clearTimeout(timer);
                worker.terminate();
                URL.revokeObjectURL(url);
                resolve(e.data);
            };
            worker.onerror = (e) => {
                clearTimeout(timer);
                worker.terminate();
                URL.revokeObjectURL(url);
                resolve({ ok: false, error: e.message || '代码执行错误' });
            };
            worker.postMessage('run');
        } catch (err) {
            if (worker) {
                try { worker.terminate(); } catch { /* noop */ }
            }
            if (url) {
                try { URL.revokeObjectURL(url); } catch { /* noop */ }
            }
            resolve({ ok: false, error: String(err && err.message || err) });
        }
    });
}

/* ==================== 事件处理 ==================== */

/** 生成前注入计算协议提示 (四层, 逻辑在 core.js 便于测试) */
function onSettingsReady(generate_data) {
    if (!generate_data || !Array.isArray(generate_data.messages)) return;
    const { messages, toolChoice } = injectMathInstructions(generate_data.messages, settings);
    generate_data.messages = messages;
    if (toolChoice) {
        generate_data.tool_choice = toolChoice;
    }
}

/** 消息生成完成后处理标记 */
async function onMessageReceived(messageId) {
    if (!settings.replace_markers) return;
    const message = chat[messageId];
    if (!message || typeof message.mes !== 'string') return;
    if (!message.mes.includes('⟦calc⟧') && !message.mes.includes('⟦code⟧')) return;

    const deps = {
        executeCode: (code) => executeCodeSandbox(code, settings.code_timeout),
        evaluate: (expr) => tryEvaluateMath(expr),
    };
    const result = await processMarkers(message.mes, deps);

    // 记录日志 (无论是否替换成功, 失败也要能看到原因)
    if (result.logs.length > 0) {
        for (const log of result.logs) {
            calcLog.unshift(log);
        }
        calcLog.length = Math.min(calcLog.length, 50);
        renderLog();
    }

    if (!result.changed) return;

    // 更新聊天数据
    message.mes = result.text;
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = result.text;
    }

    // 更新 DOM (处理后用 span 高亮结果)
    const el = $(`.mes[mesid="${messageId}"] .mes_text`);
    if (el.length) {
        const domHtml = await processMarkersDom(el.html(), deps);
        el.html(domHtml);
    }

    await saveChatConditional();
}

/* ==================== 原生函数工具 ==================== */

function registerNativeTools() {
    if (!settings.native_tools) {
        ToolManager.unregisterFunctionTool('math_evaluate');
        ToolManager.unregisterFunctionTool('math_execute_code');
        return;
    }

    ToolManager.registerFunctionTool({
        name: 'math_evaluate',
        displayName: '数学计算',
        description: [
            '计算数学表达式并返回精确数值结果。',
            '支持: 四则运算 + - * /、取模 mod、百分比 50%=0.5、幂 ^ **、括号、阶乘 !、变量赋值 a=5; a*2;',
            '骰子: 2d6(掷2个6面骰)、4d6k3(掷4取3最大)、d20、d(6)、2d(3+3);',
            '函数: sin cos tan sqrt log ln log10 exp abs floor ceil round trunc sign min max pow hypot random randint gcd lcm comb perm fac;',
            '常量: pi e tau。',
            '当角色扮演中需要任何数值计算(伤害、掷骰、概率、资源、属性)时必须调用此工具, 禁止心算。',
        ].join(' '),
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: '要计算的数学表达式, 如 "2d6+5" 或 "(17*23+5)/2"',
                },
            },
            required: ['expression'],
        }),
        action: async (args) => {
            if (!args || typeof args.expression !== 'string' || !args.expression.trim()) {
                throw new Error('缺少 expression 参数');
            }
            const r = tryEvaluateMath(args.expression);
            if (!r.ok) {
                throw new Error(`表达式错误: ${r.error}`);
            }
            return String(r.text);
        },
        shouldRegister: () => ToolManager.isToolCallingSupported(),
    });

    ToolManager.registerFunctionTool({
        name: 'math_execute_code',
        displayName: '执行代码',
        description: [
            '在沙箱中执行 JavaScript 代码并返回结果(字符串或 JSON)。',
            '用于复杂计算: 循环、数组、概率模拟、统计等。代码用 return 返回结果, 例如: let sum=0; for(let i=1;i<=100;i++) sum+=i; return sum;',
            '沙箱环境无 DOM 无网络, 纯计算能力。当数学表达式无法表达需求时使用此工具。',
        ].join(' '),
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'JavaScript 代码, 最后用 return 返回结果',
                },
            },
            required: ['code'],
        }),
        action: async (args) => {
            if (!args || typeof args.code !== 'string' || !args.code.trim()) {
                throw new Error('缺少 code 参数');
            }
            const r = await executeCodeSandbox(args.code, settings.code_timeout);
            if (!r.ok) {
                throw new Error(r.error);
            }
            return r.result;
        },
        shouldRegister: () => ToolManager.isToolCallingSupported(),
    });
}

/* ==================== 斜杠命令 ==================== */

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'math',
        aliases: ['calc'],
        callback: async (args, value) => {
            if (!value || !value.trim()) return '用法: /math 表达式, 如 /math 2d6+5';
            const r = tryEvaluateMath(value);
            if (!r.ok) return `⚠️ ${r.error}`;
            calcLog.unshift(`[命令] ${value.trim()} = ${r.text}`);
            calcLog.length = Math.min(calcLog.length, 50);
            renderLog();
            return `${value.trim()} = ${r.text}`;
        },
        helpString: '计算数学表达式, 支持骰子/函数/变量。例: /math 2d6+5, /math comb(52,5)',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'mathexec',
        callback: async (args, value) => {
            if (!value || !value.trim()) return '用法: /mathexec JavaScript代码, 代码用 return 返回结果';
            const r = await executeCodeSandbox(value, settings.code_timeout);
            if (!r.ok) return `⚠️ ${r.error}`;
            calcLog.unshift(`[代码命令] ${value.slice(0, 60)} → ${r.result}`);
            calcLog.length = Math.min(calcLog.length, 50);
            renderLog();
            return r.result;
        },
        helpString: '在沙箱中执行 JavaScript 代码并返回结果',
    }));
}

/* ==================== 设置 UI ==================== */

function renderLog() {
    const container = $('#mt_log');
    if (!container.length) return;
    if (calcLog.length === 0) {
        container.html('<div class="mt_log_empty">暂无计算记录</div>');
        return;
    }
    container.html(calcLog.map((log) =>
        `<div class="mt_log_item" title="点击复制">${escapeHtml(log)}</div>`
    ).join(''));
    // 点击复制
    container.off('click').on('click', '.mt_log_item', function () {
        const text = $(this).text();
        navigator.clipboard?.writeText(text).catch(() => { });
        $(this).addClass('mt_log_copied');
        setTimeout(() => $(this).removeClass('mt_log_copied'), 800);
    });
}

function onSettingsInput() {
    settings.inject_prompt = $('#mt_inject_prompt').prop('checked');
    settings.replace_markers = $('#mt_replace_markers').prop('checked');
    settings.native_tools = $('#mt_native_tools').prop('checked');
    settings.strict_mode = $('#mt_strict_mode').prop('checked');
    settings.keyword_boost = $('#mt_keyword_boost').prop('checked');
    settings.code_timeout = Math.max(1000, Number($('#mt_code_timeout').val()) || 10000);
    settings.instruction = $('#mt_instruction').val();
    extension_settings[extensionName] = settings;
    registerNativeTools();
}

async function initUI() {
    try {
        const settingsHtml = await renderExtensionTemplateAsync(extensionFolderPath, 'settings');
        $('#extensions_settings2').append(settingsHtml);

        $('#mt_inject_prompt').prop('checked', settings.inject_prompt).on('input', onSettingsInput);
        $('#mt_replace_markers').prop('checked', settings.replace_markers).on('input', onSettingsInput);
        $('#mt_native_tools').prop('checked', settings.native_tools).on('input', onSettingsInput);
        $('#mt_strict_mode').prop('checked', settings.strict_mode).on('input', onSettingsInput);
        $('#mt_keyword_boost').prop('checked', settings.keyword_boost).on('input', onSettingsInput);
        $('#mt_code_timeout').val(settings.code_timeout).on('input', onSettingsInput);
        $('#mt_instruction').val(settings.instruction).on('input', onSettingsInput);
    } catch (error) {
        // 设置面板加载失败不阻塞核心功能 (工具注册/事件绑定/标记替换)
        console.warn('[MathTools] 设置面板加载失败, 核心功能不受影响:', error);
    }
    renderLog();
}

/* ==================== 初始化 ==================== */

jQuery(async () => {
    loadSettings();
    await initUI();
    registerNativeTools();
    registerSlashCommands();

    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    console.log('[MathTools] 数学计算工具扩展已加载');
});
