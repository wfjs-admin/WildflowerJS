/**
 * CSPExpressionEvaluator - CSP-Safe Expression Parsing and Evaluation
 *
 * Provides Content Security Policy compliant expression evaluation using
 * a JavaScript expression parser (JSEP) and AST interpreter, avoiding
 * the need for `new Function()` or `eval()`.
 *
 * This module enables WildflowerJS to work in environments with strict
 * CSP headers that block `unsafe-eval`.
 *
 * @module CSPExpressionEvaluator
 */

// =============================================================================
// JSEP - JavaScript Expression Parser (Inlined)
// https://github.com/EricSmekens/jsep - MIT License
// Minimal version supporting WildflowerJS expression grammar
// =============================================================================

const PERIOD_CODE = 46; // '.'
const COMMA_CODE = 44;  // ','
const SQUOTE_CODE = 39; // '
const DQUOTE_CODE = 34; // "
const OPAREN_CODE = 40; // (
const CPAREN_CODE = 41; // )
const OBRACK_CODE = 91; // [
const CBRACK_CODE = 93; // ]
const QUMARK_CODE = 63; // ?
const COLON_CODE = 58;  // :

// Binary operation precedences
const binaryPrecedence = {
    '||': 1,
    '&&': 2,
    '|': 3,
    '^': 4,
    '&': 5,
    '==': 6, '!=': 6, '===': 6, '!==': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7,
    '<<': 8, '>>': 8, '>>>': 8,
    '+': 9, '-': 9,
    '*': 10, '/': 10, '%': 10
};

// Unary operators
const unaryOps = { '-': 1, '!': 1, '~': 1, '+': 1 };

// Literals map
const literals = {
    'true': true,
    'false': false,
    'null': null,
    'undefined': undefined
};

// Character classification helpers
function isDecimalDigit(ch) {
    return ch >= 48 && ch <= 57; // 0-9
}

function isIdentifierStart(ch) {
    return (ch === 36) || (ch === 95) || // $ _
           (ch >= 65 && ch <= 90) ||     // A-Z
           (ch >= 97 && ch <= 122);      // a-z
}

function isIdentifierPart(ch) {
    return isIdentifierStart(ch) || isDecimalDigit(ch);
}

/**
 * Parse a JavaScript expression into an AST
 * @param {string} expr - The expression to parse
 * @returns {Object|null} The AST node, or null if parsing failed
 */
function parseExpression(expr) {
    if (!expr || typeof expr !== 'string') {
        return null;
    }

    let index = 0;
    const length = expr.length;

    function throwError(message) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.error(
                `[WF-CSP-SYNTAX] Cannot parse expression: "${expr}"\n` +
                `Error at position ${index}: ${message}\n` +
                `CSP mode supports: identifiers, member access, arithmetic, ` +
                `comparisons, logical operators, ternary, and external() calls.\n` +
                `Unsupported: arrow functions, template literals, destructuring, spread, async/await.`
            );
        }
        return null;
    }

    function charCodeAt(i) {
        return expr.charCodeAt(i);
    }

    function exprAt(i) {
        return expr.charAt(i);
    }

    // Skip whitespace (space, tab, newline, carriage return)
    function gobbleSpaces() {
        let ch;
        while (index < length && ((ch = expr.charCodeAt(index)) === 32 || ch === 9 || ch === 10 || ch === 13)) {
            index++;
        }
    }

    // Main expression parser
    function gobbleExpression() {
        const node = gobbleBinaryExpression();
        gobbleSpaces();

        // Check for ternary
        if (charCodeAt(index) === QUMARK_CODE) {
            index++;
            const consequent = gobbleExpression();
            if (!consequent) {
                return throwError('Expected expression after ?');
            }
            gobbleSpaces();
            if (charCodeAt(index) !== COLON_CODE) {
                return throwError('Expected : in ternary expression');
            }
            index++;
            const alternate = gobbleExpression();
            if (!alternate) {
                return throwError('Expected expression after :');
            }
            return {
                type: 'ConditionalExpression',
                test: node,
                consequent,
                alternate
            };
        }

        return node;
    }

    // Binary expression with precedence climbing
    function gobbleBinaryExpression() {
        let left = gobbleUnaryExpression();
        if (!left) return left;

        let biop = gobbleBinaryOp();
        if (!biop) return left;

        let biopPrec = binaryPrecedence[biop];
        if (!biopPrec) return left;

        let right = gobbleUnaryExpression();
        if (!right) {
            return throwError(`Expected expression after ${biop}`);
        }

        let stack = [left, biop, right];
        let curBiop = gobbleBinaryOp();

        while (curBiop) {
            let curPrec = binaryPrecedence[curBiop];
            if (!curPrec) break;

            while (stack.length > 2 && curPrec <= binaryPrecedence[stack[stack.length - 2]]) {
                right = stack.pop();
                biop = stack.pop();
                left = stack.pop();
                const node = {
                    type: biop === '||' || biop === '&&' ? 'LogicalExpression' : 'BinaryExpression',
                    operator: biop,
                    left,
                    right
                };
                stack.push(node);
            }

            let nextRight = gobbleUnaryExpression();
            if (!nextRight) {
                return throwError(`Expected expression after ${curBiop}`);
            }
            stack.push(curBiop, nextRight);
            curBiop = gobbleBinaryOp();
        }

        // Build final tree
        let i = stack.length - 1;
        let node = stack[i];
        while (i > 1) {
            biop = stack[i - 1];
            left = stack[i - 2];
            node = {
                type: biop === '||' || biop === '&&' ? 'LogicalExpression' : 'BinaryExpression',
                operator: biop,
                left,
                right: node
            };
            i -= 2;
        }
        return node;
    }

    // Get binary operator at current position
    function gobbleBinaryOp() {
        gobbleSpaces();
        let toCheck = expr.slice(index, index + 3);

        // Check 3-char operators first, then 2-char, then 1-char
        if (binaryPrecedence[toCheck]) {
            index += 3;
            return toCheck;
        }
        toCheck = toCheck.slice(0, 2);
        if (binaryPrecedence[toCheck]) {
            index += 2;
            return toCheck;
        }
        toCheck = toCheck.charAt(0);
        if (binaryPrecedence[toCheck]) {
            index += 1;
            return toCheck;
        }
        return null;
    }

    // Unary expression
    function gobbleUnaryExpression() {
        gobbleSpaces();
        const ch = charCodeAt(index);
        let arg;

        if (unaryOps[exprAt(index)]) {
            const op = exprAt(index);
            index++;
            arg = gobbleUnaryExpression();
            if (!arg) {
                return throwError(`Expected expression after unary ${op}`);
            }
            return {
                type: 'UnaryExpression',
                operator: op,
                argument: arg,
                prefix: true
            };
        }

        return gobbleCallExpression();
    }

    // Call expression (function calls and member access)
    function gobbleCallExpression() {
        let node = gobbleToken();
        if (!node) return node;

        gobbleSpaces();
        let ch = charCodeAt(index);

        while (ch === OPAREN_CODE || ch === OBRACK_CODE || ch === PERIOD_CODE) {
            if (ch === OPAREN_CODE) {
                // Function call
                index++;
                const args = gobbleArguments(CPAREN_CODE);
                node = {
                    type: 'CallExpression',
                    callee: node,
                    arguments: args
                };
            } else if (ch === OBRACK_CODE) {
                // Computed member access: obj[expr]
                index++;
                const property = gobbleExpression();
                gobbleSpaces();
                if (charCodeAt(index) !== CBRACK_CODE) {
                    return throwError('Expected ]');
                }
                index++;
                node = {
                    type: 'MemberExpression',
                    object: node,
                    property,
                    computed: true
                };
            } else if (ch === PERIOD_CODE) {
                // Dot member access: obj.prop
                index++;
                gobbleSpaces();
                const property = gobbleIdentifier();
                if (!property) {
                    return throwError('Expected property name after .');
                }
                node = {
                    type: 'MemberExpression',
                    object: node,
                    property,
                    computed: false
                };
            }
            gobbleSpaces();
            ch = charCodeAt(index);
        }

        return node;
    }

    // Parse function arguments
    function gobbleArguments(terminator) {
        const args = [];
        let closed = false;

        gobbleSpaces();
        while (index < length) {
            if (charCodeAt(index) === terminator) {
                closed = true;
                index++;
                break;
            }
            const arg = gobbleExpression();
            if (!arg) break;
            args.push(arg);
            gobbleSpaces();
            if (charCodeAt(index) === COMMA_CODE) {
                index++;
                gobbleSpaces();
            }
        }

        if (!closed) {
            return throwError('Expected closing parenthesis');
        }

        return args;
    }

    // Token: identifier, literal, number, string, or grouped expression
    function gobbleToken() {
        gobbleSpaces();
        const ch = charCodeAt(index);

        // Numeric literal
        if (isDecimalDigit(ch) || ch === PERIOD_CODE) {
            return gobbleNumericLiteral();
        }

        // String literal
        if (ch === SQUOTE_CODE || ch === DQUOTE_CODE) {
            return gobbleStringLiteral();
        }

        // Array literal
        if (ch === OBRACK_CODE) {
            return gobbleArrayLiteral();
        }

        // Grouped expression
        if (ch === OPAREN_CODE) {
            index++;
            const node = gobbleExpression();
            gobbleSpaces();
            if (charCodeAt(index) !== CPAREN_CODE) {
                return throwError('Expected closing parenthesis');
            }
            index++;
            return node;
        }

        // Identifier or literal keyword
        if (isIdentifierStart(ch)) {
            return gobbleIdentifier();
        }

        return null;
    }

    // Numeric literal
    function gobbleNumericLiteral() {
        let number = '';
        while (isDecimalDigit(charCodeAt(index))) {
            number += exprAt(index++);
        }

        if (charCodeAt(index) === PERIOD_CODE) {
            number += exprAt(index++);
            while (isDecimalDigit(charCodeAt(index))) {
                number += exprAt(index++);
            }
        }

        // Handle exponent
        let ch = charCodeAt(index);
        if (ch === 101 || ch === 69) { // e E
            number += exprAt(index++);
            ch = charCodeAt(index);
            if (ch === 43 || ch === 45) { // + -
                number += exprAt(index++);
            }
            while (isDecimalDigit(charCodeAt(index))) {
                number += exprAt(index++);
            }
        }

        return {
            type: 'Literal',
            value: parseFloat(number),
            raw: number
        };
    }

    // String literal
    function gobbleStringLiteral() {
        const quote = exprAt(index);
        index++;
        let str = '';

        while (index < length) {
            let ch = exprAt(index++);
            if (ch === quote) {
                return {
                    type: 'Literal',
                    value: str,
                    raw: quote + str + quote
                };
            }
            if (ch === '\\') {
                ch = exprAt(index++);
                switch (ch) {
                    case 'n': str += '\n'; break;
                    case 'r': str += '\r'; break;
                    case 't': str += '\t'; break;
                    case '\\': str += '\\'; break;
                    case quote: str += quote; break;
                    default: str += ch;
                }
            } else {
                str += ch;
            }
        }

        return throwError('Unterminated string literal');
    }

    // Array literal
    function gobbleArrayLiteral() {
        index++; // Skip [
        gobbleSpaces();

        const elements = [];
        while (index < length && charCodeAt(index) !== CBRACK_CODE) {
            const element = gobbleExpression();
            if (element) {
                elements.push(element);
            }
            gobbleSpaces();
            if (charCodeAt(index) === COMMA_CODE) {
                index++;
                gobbleSpaces();
            }
        }

        if (charCodeAt(index) !== CBRACK_CODE) {
            return throwError('Expected ]');
        }
        index++;

        return {
            type: 'ArrayExpression',
            elements
        };
    }

    // Identifier
    function gobbleIdentifier() {
        let start = index;
        let ch = charCodeAt(index);

        if (!isIdentifierStart(ch)) {
            return null;
        }

        index++;
        while (index < length && isIdentifierPart(charCodeAt(index))) {
            index++;
        }

        const identifier = expr.slice(start, index);

        // Check for literal keywords
        if (identifier in literals) {
            return {
                type: 'Literal',
                value: literals[identifier],
                raw: identifier
            };
        }

        return {
            type: 'Identifier',
            name: identifier
        };
    }

    // Parse the expression
    try {
        const ast = gobbleExpression();
        gobbleSpaces();

        // Ensure we consumed the entire expression
        if (index < length) {
            return throwError(`Unexpected character at position ${index}`);
        }

        return ast;
    } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.error(`[WF-CSP-SYNTAX] Parse error in expression: "${expr}"`, e);
        }
        return null;
    }
}

// =============================================================================
// Security Blocklists
// =============================================================================

/**
 * Properties that could enable prototype pollution attacks
 */
const BLOCKED_PROPERTIES = new Set([
    '__proto__',
    'prototype',
    'constructor',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__'
]);

/**
 * Global objects that should never be accessible from expressions
 * Users should use external() for controlled cross-component access
 */
const BLOCKED_GLOBALS = new Set([
    'window',
    'document',
    'globalThis',
    'self',
    'top',
    'parent',
    'frames',
    'location',
    'navigator',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'eval',
    'Function',
    'setTimeout',
    'setInterval',
    'requestAnimationFrame',
    'importScripts',
    'alert',
    'confirm',
    'prompt',
    'open',
    'close'
]);

// =============================================================================
// AST Evaluator
// =============================================================================

/**
 * Binary operators implementation
 */
const binops = {
    '||': (a, b) => a || b,
    '&&': (a, b) => a && b,
    '|': (a, b) => a | b,
    '^': (a, b) => a ^ b,
    '&': (a, b) => a & b,
    '==': (a, b) => a == b,
    '!=': (a, b) => a != b,
    '===': (a, b) => a === b,
    '!==': (a, b) => a !== b,
    '<': (a, b) => a < b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
    '<<': (a, b) => a << b,
    '>>': (a, b) => a >> b,
    '>>>': (a, b) => a >>> b,
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => a / b,
    '%': (a, b) => a % b
};

/**
 * Unary operators implementation
 */
const unops = {
    '-': (a) => -a,
    '+': (a) => +a,
    '!': (a) => !a,
    '~': (a) => ~a
};

/**
 * Evaluate an AST node with the given context
 * @param {Object} node - The AST node to evaluate
 * @param {Object} context - The context object containing variable values
 * @returns {*} The evaluated result
 */
function evaluateAST(node, context) {
    if (!node) return undefined;

    switch (node.type) {
        case 'Literal':
            return node.value;

        case 'Identifier':
            return evaluateIdentifier(node, context);

        case 'MemberExpression':
            return evaluateMember(node, context);

        case 'BinaryExpression':
            return binops[node.operator](
                evaluateAST(node.left, context),
                evaluateAST(node.right, context)
            );

        case 'LogicalExpression':
            // CRITICAL: Short-circuit evaluation
            if (node.operator === '||') {
                const left = evaluateAST(node.left, context);
                return left ? left : evaluateAST(node.right, context);
            }
            if (node.operator === '&&') {
                const left = evaluateAST(node.left, context);
                return left ? evaluateAST(node.right, context) : left;
            }
            return undefined;

        case 'UnaryExpression':
            return unops[node.operator](evaluateAST(node.argument, context));

        case 'ConditionalExpression':
            // CRITICAL: Short-circuit - only evaluate taken branch
            return evaluateAST(node.test, context)
                ? evaluateAST(node.consequent, context)
                : evaluateAST(node.alternate, context);

        case 'CallExpression':
            return evaluateCall(node, context);

        case 'ArrayExpression':
            return node.elements.map(el => evaluateAST(el, context));

        default:
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.warn(
                    `[WF-CSP-UNSUPPORTED] Expression uses unsupported syntax: ${node.type}\n` +
                    `Consider using a computed property or component method instead.`
                );
            }
            return undefined;
    }
}

/**
 * Evaluate an identifier node
 * @param {Object} node - The identifier node
 * @param {Object} context - The context object
 * @returns {*} The identifier's value from context
 */
function evaluateIdentifier(node, context) {
    const name = node.name;

    // Block access to dangerous globals
    if (BLOCKED_GLOBALS.has(name)) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(
                `[WF-CSP-SECURITY] Blocked access to global "${name}" in expression. ` +
                `Use external() for cross-component data access.`
            );
        }
        return undefined;
    }

    // Only resolve from provided context, never fall back to global scope
    return context[name];
}

/**
 * Evaluate a member expression (dot or bracket notation)
 * @param {Object} node - The member expression node
 * @param {Object} context - The context object
 * @returns {*} The member value
 */
function evaluateMember(node, context) {
    const obj = evaluateAST(node.object, context);
    if (obj == null) return undefined;

    // Get property name
    const prop = node.computed
        ? evaluateAST(node.property, context)  // items[0] or items[variable]
        : node.property.name;                   // user.name

    // Security check for blocked properties
    if (BLOCKED_PROPERTIES.has(prop)) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(`[WF-CSP-SECURITY] Blocked property access: ${prop}`);
        }
        return undefined;
    }

    return obj[prop];
}

/**
 * Evaluate a function call expression
 * Only allows whitelisted functions (currently just `external`)
 * @param {Object} node - The call expression node
 * @param {Object} context - The context object
 * @returns {*} The function call result
 */
function evaluateCall(node, context) {
    // Only allow external() calls for cross-component data access
    if (node.callee.type === 'Identifier' && node.callee.name === 'external') {
        const args = node.arguments.map(arg => evaluateAST(arg, context));
        const externalFn = context.external;
        if (typeof externalFn === 'function') {
            return externalFn(...args);
        }
        return undefined;
    }

    // Block arbitrary function calls — only external() is permitted
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const calleeName = node.callee.type === 'Identifier'
            ? node.callee.name
            : 'anonymous';
        console.warn(
            `[WF-CSP-SECURITY] Blocked function call: ${calleeName}. ` +
            `Only external() is allowed in expressions.`
        );
    }
    return undefined;
}

// =============================================================================
// Public API for Framework Integration
// =============================================================================

/**
 * Create a CSP-safe evaluator function for an expression
 * This returns a function that can be called with a context object
 *
 * @param {string} expression - The expression to compile
 * @param {Map} astCache - Cache for storing parsed ASTs
 * @param {string} cachePrefix - Cache key prefix
 * @returns {Function|null} An evaluator function, or null if parsing failed
 */
function getCSPSafeEvaluator(expression, astCache, cachePrefix = 'csp') {
    const cacheKey = `${cachePrefix}::${expression}`;

    // Check cache first
    if (astCache.has(cacheKey)) {
        return astCache.get(cacheKey);
    }

    // Parse expression to AST
    const ast = parseExpression(expression);
    if (!ast) {
        // Cache null to avoid repeated parse attempts
        astCache.set(cacheKey, null);
        return null;
    }

    // Create evaluator closure
    const evaluator = (context) => evaluateAST(ast, context);

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        evaluator._ast = ast;
        evaluator._isCSPSafe = true;
    }

    // Cache and return
    astCache.set(cacheKey, evaluator);
    return evaluator;
}

/**
 * Create a CSP-safe evaluator that takes individual arguments (like new Function())
 * This matches the signature expected by the existing expression evaluation code
 *
 * @param {string} expression - The expression to compile
 * @param {string[]} contextKeys - The variable names in order
 * @param {Map} astCache - Cache for storing parsed ASTs
 * @param {string} cachePrefix - Cache key prefix
 * @returns {Function|null} An evaluator function that takes args in order, or null
 */
function getCSPSafeEvaluatorWithArgs(expression, contextKeys, astCache, cachePrefix = 'csp') {
    const cacheKey = `${cachePrefix}::${expression}::${contextKeys.join(',')}`;

    // Check cache first
    if (astCache.has(cacheKey)) {
        return astCache.get(cacheKey);
    }

    // Parse expression to AST
    const ast = parseExpression(expression);
    if (!ast) {
        astCache.set(cacheKey, null);
        return null;
    }

    // Create evaluator that maps args to context object
    const evaluator = function(...args) {
        const context = {};
        for (let i = 0; i < contextKeys.length; i++) {
            context[contextKeys[i]] = args[i];
        }
        return evaluateAST(ast, context);
    };

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        evaluator._ast = ast;
        evaluator._isCSPSafe = true;
        evaluator._contextKeys = contextKeys;
    }

    astCache.set(cacheKey, evaluator);
    return evaluator;
}

/**
 * Create a CSP-safe evaluator using destructuring context (for merged contexts)
 * This matches the pattern used in TemplateSystem.js compiled evaluators
 *
 * @param {string} expression - The expression to compile
 * @param {string[]} varNames - Variable names to extract from context
 * @param {Map} astCache - Cache for storing parsed ASTs
 * @param {string} cachePrefix - Cache key prefix
 * @returns {Function|null} An evaluator function taking a context object
 */
function getCSPSafeMergedContextEvaluator(expression, varNames, astCache, cachePrefix = 'csp-merged') {
    const cacheKey = `${cachePrefix}::${expression}`;

    if (astCache.has(cacheKey)) {
        return astCache.get(cacheKey);
    }

    const ast = parseExpression(expression);
    if (!ast) {
        astCache.set(cacheKey, null);
        return null;
    }

    // Create evaluator that uses context directly (merged context pattern)
    const evaluator = (ctx) => evaluateAST(ast, ctx);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        evaluator._ast = ast;
        evaluator._isCSPSafe = true;
        evaluator._usesMergedContext = true;
    }

    astCache.set(cacheKey, evaluator);
    return evaluator;
}

// =============================================================================
// Exports
// =============================================================================

export {
    parseExpression,
    evaluateAST,
    getCSPSafeEvaluator,
    getCSPSafeEvaluatorWithArgs,
    getCSPSafeMergedContextEvaluator,
    BLOCKED_PROPERTIES,
    BLOCKED_GLOBALS
};
