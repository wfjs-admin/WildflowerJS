/**
 * CSP-Safe Expression Evaluation Tests
 *
 * Tests the Content Security Policy compliant expression evaluation system
 * that uses JSEP parser and AST interpreter instead of new Function().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    parseExpression,
    evaluateAST,
    getCSPSafeEvaluator,
    getCSPSafeEvaluatorWithArgs,
    getCSPSafeMergedContextEvaluator,
    BLOCKED_PROPERTIES,
    BLOCKED_GLOBALS
} from '../src/core/CSPExpressionEvaluator.js';

describe('CSP Expression Parser (JSEP)', () => {
    describe('Literals', () => {
        it('should parse numeric literals', () => {
            const ast = parseExpression('42');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('Literal');
            expect(ast.value).toBe(42);
        });

        it('should parse float literals', () => {
            const ast = parseExpression('3.14');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe(3.14);
        });

        it('should parse string literals with single quotes', () => {
            const ast = parseExpression("'hello'");
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('Literal');
            expect(ast.value).toBe('hello');
        });

        it('should parse string literals with double quotes', () => {
            const ast = parseExpression('"world"');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe('world');
        });

        it('should parse boolean true', () => {
            const ast = parseExpression('true');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe(true);
        });

        it('should parse boolean false', () => {
            const ast = parseExpression('false');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe(false);
        });

        it('should parse null', () => {
            const ast = parseExpression('null');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe(null);
        });

        it('should parse undefined', () => {
            const ast = parseExpression('undefined');
            expect(ast).toBeTruthy();
            expect(ast.value).toBe(undefined);
        });
    });

    describe('Identifiers', () => {
        it('should parse simple identifier', () => {
            const ast = parseExpression('count');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('Identifier');
            expect(ast.name).toBe('count');
        });

        it('should parse identifier with underscore', () => {
            const ast = parseExpression('_privateVar');
            expect(ast).toBeTruthy();
            expect(ast.name).toBe('_privateVar');
        });

        it('should parse identifier with dollar sign', () => {
            const ast = parseExpression('$data');
            expect(ast).toBeTruthy();
            expect(ast.name).toBe('$data');
        });
    });

    describe('Member Expressions', () => {
        it('should parse dot notation', () => {
            const ast = parseExpression('user.name');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('MemberExpression');
            expect(ast.computed).toBe(false);
            expect(ast.property.name).toBe('name');
        });

        it('should parse nested dot notation', () => {
            const ast = parseExpression('data.nested.deep.value');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('MemberExpression');
        });

        it('should parse bracket notation with number', () => {
            const ast = parseExpression('items[0]');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('MemberExpression');
            expect(ast.computed).toBe(true);
        });

        it('should parse bracket notation with string', () => {
            const ast = parseExpression("obj['key']");
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('MemberExpression');
            expect(ast.computed).toBe(true);
        });

        it('should parse mixed notation', () => {
            const ast = parseExpression('items[0].name');
            expect(ast).toBeTruthy();
        });
    });

    describe('Binary Expressions', () => {
        it('should parse addition', () => {
            const ast = parseExpression('a + b');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('BinaryExpression');
            expect(ast.operator).toBe('+');
        });

        it('should parse subtraction', () => {
            const ast = parseExpression('a - b');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('-');
        });

        it('should parse multiplication', () => {
            const ast = parseExpression('price * quantity');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('*');
        });

        it('should parse division', () => {
            const ast = parseExpression('total / count');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('/');
        });

        it('should parse modulo', () => {
            const ast = parseExpression('index % 2');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('%');
        });

        it('should respect operator precedence', () => {
            const ast = parseExpression('a + b * c');
            expect(ast).toBeTruthy();
            // b * c should be grouped first due to precedence
            expect(ast.operator).toBe('+');
            expect(ast.right.operator).toBe('*');
        });

        it('should handle parentheses for grouping', () => {
            const ast = parseExpression('(a + b) * c');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('*');
        });
    });

    describe('Comparison Expressions', () => {
        it('should parse greater than', () => {
            const ast = parseExpression('count > 5');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('>');
        });

        it('should parse less than', () => {
            const ast = parseExpression('age < 18');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('<');
        });

        it('should parse greater than or equal', () => {
            const ast = parseExpression('score >= 60');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('>=');
        });

        it('should parse less than or equal', () => {
            const ast = parseExpression('level <= 10');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('<=');
        });

        it('should parse strict equality', () => {
            const ast = parseExpression("status === 'active'");
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('===');
        });

        it('should parse strict inequality', () => {
            const ast = parseExpression('type !== null');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('!==');
        });

        it('should parse loose equality', () => {
            const ast = parseExpression('value == 0');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('==');
        });

        it('should parse loose inequality', () => {
            const ast = parseExpression('data != undefined');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('!=');
        });
    });

    describe('Logical Expressions', () => {
        it('should parse logical AND', () => {
            const ast = parseExpression('isLoading && hasData');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('LogicalExpression');
            expect(ast.operator).toBe('&&');
        });

        it('should parse logical OR', () => {
            const ast = parseExpression('error || defaultValue');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('LogicalExpression');
            expect(ast.operator).toBe('||');
        });

        it('should handle complex logical expressions', () => {
            const ast = parseExpression('a && b || c && d');
            expect(ast).toBeTruthy();
        });
    });

    describe('Unary Expressions', () => {
        it('should parse negation', () => {
            const ast = parseExpression('!isVisible');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('UnaryExpression');
            expect(ast.operator).toBe('!');
        });

        it('should parse double negation', () => {
            const ast = parseExpression('!!value');
            expect(ast).toBeTruthy();
        });

        it('should parse negative number', () => {
            const ast = parseExpression('-count');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('-');
        });

        it('should parse unary plus', () => {
            const ast = parseExpression('+value');
            expect(ast).toBeTruthy();
            expect(ast.operator).toBe('+');
        });
    });

    describe('Conditional (Ternary) Expressions', () => {
        it('should parse simple ternary', () => {
            const ast = parseExpression("isAdmin ? 'Admin' : 'User'");
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('ConditionalExpression');
        });

        it('should parse ternary with expressions', () => {
            const ast = parseExpression("count === 0 ? 'Empty' : count");
            expect(ast).toBeTruthy();
        });

        it('should parse nested ternary', () => {
            const ast = parseExpression('a ? b : c ? d : e');
            expect(ast).toBeTruthy();
        });
    });

    describe('Call Expressions', () => {
        it('should parse function call with no arguments', () => {
            const ast = parseExpression('getData()');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('CallExpression');
            expect(ast.arguments).toHaveLength(0);
        });

        it('should parse function call with string arguments', () => {
            const ast = parseExpression("external('store', 'items')");
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('CallExpression');
            expect(ast.arguments).toHaveLength(2);
        });

        it('should parse function call with mixed arguments', () => {
            const ast = parseExpression("func(1, 'hello', true)");
            expect(ast).toBeTruthy();
            expect(ast.arguments).toHaveLength(3);
        });
    });

    describe('Array Expressions', () => {
        it('should parse array literal', () => {
            const ast = parseExpression('[1, 2, 3]');
            expect(ast).toBeTruthy();
            expect(ast.type).toBe('ArrayExpression');
            expect(ast.elements).toHaveLength(3);
        });

        it('should parse empty array', () => {
            const ast = parseExpression('[]');
            expect(ast).toBeTruthy();
            expect(ast.elements).toHaveLength(0);
        });
    });
});

describe('AST Evaluator', () => {
    describe('Literal evaluation', () => {
        it('should evaluate number', () => {
            const ast = parseExpression('42');
            expect(evaluateAST(ast, {})).toBe(42);
        });

        it('should evaluate string', () => {
            const ast = parseExpression("'hello'");
            expect(evaluateAST(ast, {})).toBe('hello');
        });

        it('should evaluate boolean', () => {
            const ast = parseExpression('true');
            expect(evaluateAST(ast, {})).toBe(true);
        });
    });

    describe('Identifier evaluation', () => {
        it('should resolve identifier from context', () => {
            const ast = parseExpression('count');
            expect(evaluateAST(ast, { count: 10 })).toBe(10);
        });

        it('should return undefined for missing identifier', () => {
            const ast = parseExpression('missing');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });
    });

    describe('Member expression evaluation', () => {
        it('should resolve dot notation', () => {
            const ast = parseExpression('user.name');
            expect(evaluateAST(ast, { user: { name: 'John' } })).toBe('John');
        });

        it('should resolve bracket notation', () => {
            const ast = parseExpression('items[0]');
            expect(evaluateAST(ast, { items: ['first', 'second'] })).toBe('first');
        });

        it('should handle null safely', () => {
            const ast = parseExpression('user.name');
            expect(evaluateAST(ast, { user: null })).toBe(undefined);
        });

        it('should handle undefined safely', () => {
            const ast = parseExpression('user.name');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });
    });

    describe('Binary expression evaluation', () => {
        it('should evaluate addition', () => {
            const ast = parseExpression('a + b');
            expect(evaluateAST(ast, { a: 5, b: 3 })).toBe(8);
        });

        it('should evaluate string concatenation', () => {
            const ast = parseExpression("greeting + ' ' + name");
            expect(evaluateAST(ast, { greeting: 'Hello', name: 'World' })).toBe('Hello World');
        });

        it('should evaluate multiplication', () => {
            const ast = parseExpression('price * quantity');
            expect(evaluateAST(ast, { price: 10, quantity: 5 })).toBe(50);
        });

        it('should evaluate complex arithmetic', () => {
            const ast = parseExpression('(a + b) * c');
            expect(evaluateAST(ast, { a: 2, b: 3, c: 4 })).toBe(20);
        });
    });

    describe('Comparison evaluation', () => {
        it('should evaluate greater than', () => {
            const ast = parseExpression('count > 5');
            expect(evaluateAST(ast, { count: 10 })).toBe(true);
            expect(evaluateAST(ast, { count: 3 })).toBe(false);
        });

        it('should evaluate strict equality', () => {
            const ast = parseExpression("status === 'active'");
            expect(evaluateAST(ast, { status: 'active' })).toBe(true);
            expect(evaluateAST(ast, { status: 'inactive' })).toBe(false);
        });
    });

    describe('Logical expression evaluation with short-circuit', () => {
        it('should short-circuit AND when left is falsy', () => {
            const ast = parseExpression('isLoading && data.length');
            // Should not throw even if data is undefined because of short-circuit
            expect(evaluateAST(ast, { isLoading: false })).toBe(false);
        });

        it('should short-circuit OR when left is truthy', () => {
            const ast = parseExpression('defaultValue || expensiveComputation');
            expect(evaluateAST(ast, { defaultValue: 'default' })).toBe('default');
        });

        it('should evaluate both sides when needed', () => {
            const ast = parseExpression('a && b');
            expect(evaluateAST(ast, { a: true, b: true })).toBe(true);
            expect(evaluateAST(ast, { a: true, b: false })).toBe(false);
        });
    });

    describe('Unary expression evaluation', () => {
        it('should evaluate negation', () => {
            const ast = parseExpression('!isVisible');
            expect(evaluateAST(ast, { isVisible: true })).toBe(false);
            expect(evaluateAST(ast, { isVisible: false })).toBe(true);
        });

        it('should evaluate double negation', () => {
            const ast = parseExpression('!!value');
            expect(evaluateAST(ast, { value: 'truthy' })).toBe(true);
            expect(evaluateAST(ast, { value: '' })).toBe(false);
        });

        it('should evaluate negative', () => {
            const ast = parseExpression('-count');
            expect(evaluateAST(ast, { count: 5 })).toBe(-5);
        });
    });

    describe('Conditional expression evaluation with short-circuit', () => {
        it('should only evaluate consequent when true', () => {
            const ast = parseExpression("isAdmin ? 'Admin' : 'User'");
            expect(evaluateAST(ast, { isAdmin: true })).toBe('Admin');
        });

        it('should only evaluate alternate when false', () => {
            const ast = parseExpression("isAdmin ? 'Admin' : 'User'");
            expect(evaluateAST(ast, { isAdmin: false })).toBe('User');
        });

        it('should not throw on undefined in non-taken branch', () => {
            // If test is true, should not evaluate undefined.property in alternate
            const ast = parseExpression('hasData ? data.value : undefined');
            expect(evaluateAST(ast, { hasData: true, data: { value: 42 } })).toBe(42);
        });
    });

    describe('Call expression evaluation', () => {
        it('should call external function', () => {
            const ast = parseExpression("external('store', 'count')");
            const external = (store, path) => `${store}.${path}`;
            expect(evaluateAST(ast, { external })).toBe('store.count');
        });

        it('should return undefined for non-external calls', () => {
            const ast = parseExpression('someFunction()');
            expect(evaluateAST(ast, { someFunction: () => 'result' })).toBe(undefined);
        });
    });

    describe('Array expression evaluation', () => {
        it('should evaluate array literal', () => {
            const ast = parseExpression('[1, 2, 3]');
            expect(evaluateAST(ast, {})).toEqual([1, 2, 3]);
        });

        it('should evaluate array with variables', () => {
            const ast = parseExpression('[a, b, c]');
            expect(evaluateAST(ast, { a: 1, b: 2, c: 3 })).toEqual([1, 2, 3]);
        });
    });
});

describe('Security Blocklists', () => {
    describe('Blocked Properties', () => {
        it('should block __proto__ access', () => {
            const ast = parseExpression('obj.__proto__');
            expect(evaluateAST(ast, { obj: {} })).toBe(undefined);
        });

        it('should block prototype access', () => {
            const ast = parseExpression('obj.prototype');
            expect(evaluateAST(ast, { obj: {} })).toBe(undefined);
        });

        it('should block constructor access', () => {
            const ast = parseExpression('obj.constructor');
            expect(evaluateAST(ast, { obj: {} })).toBe(undefined);
        });
    });

    describe('Blocked Globals', () => {
        it('should not resolve window', () => {
            const ast = parseExpression('window');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });

        it('should not resolve document', () => {
            const ast = parseExpression('document');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });

        it('should not resolve eval', () => {
            const ast = parseExpression('eval');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });

        it('should not resolve Function', () => {
            const ast = parseExpression('Function');
            expect(evaluateAST(ast, {})).toBe(undefined);
        });
    });
});

describe('CSP Evaluator Factory Functions', () => {
    describe('getCSPSafeEvaluator', () => {
        it('should return evaluator function', () => {
            const cache = new Map();
            const evaluator = getCSPSafeEvaluator('a + b', cache);
            expect(typeof evaluator).toBe('function');
        });

        it('should cache evaluators', () => {
            const cache = new Map();
            const eval1 = getCSPSafeEvaluator('a + b', cache);
            const eval2 = getCSPSafeEvaluator('a + b', cache);
            expect(eval1).toBe(eval2);
        });

        it('should evaluate with context', () => {
            const cache = new Map();
            const evaluator = getCSPSafeEvaluator('a + b', cache);
            expect(evaluator({ a: 1, b: 2 })).toBe(3);
        });
    });

    describe('getCSPSafeEvaluatorWithArgs', () => {
        it('should return evaluator that takes args in order', () => {
            const cache = new Map();
            const evaluator = getCSPSafeEvaluatorWithArgs('a + b', ['a', 'b'], cache);
            expect(evaluator(1, 2)).toBe(3);
        });

        it('should cache with context keys in key', () => {
            const cache = new Map();
            const eval1 = getCSPSafeEvaluatorWithArgs('a + b', ['a', 'b'], cache);
            const eval2 = getCSPSafeEvaluatorWithArgs('a + b', ['b', 'a'], cache);
            // Different arg order = different cache key
            expect(eval1).not.toBe(eval2);
        });
    });

    describe('getCSPSafeMergedContextEvaluator', () => {
        it('should return evaluator that takes context object', () => {
            const cache = new Map();
            const evaluator = getCSPSafeMergedContextEvaluator('a + b', ['a', 'b'], cache);
            expect(evaluator({ a: 1, b: 2 })).toBe(3);
        });

        it('should have _usesMergedContext flag when __DEV__ is enabled', () => {
            const cache = new Map();
            const evaluator = getCSPSafeMergedContextEvaluator('a + b', ['a', 'b'], cache);
            // _usesMergedContext is only set when __DEV__ is defined (in bundled builds)
            // In direct-import test environments, __DEV__ is not defined
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
                expect(evaluator._usesMergedContext).toBe(true);
            } else {
                expect(evaluator._usesMergedContext).toBeUndefined();
            }
        });
    });
});

describe('Expression Patterns (from Appendix B)', () => {
    // These are the expression patterns documented in CSP_SAFE_EXPRESSION_EVALUATION_2026-01-25.md

    describe('Simple paths', () => {
        it('should evaluate count', () => {
            const ast = parseExpression('count');
            expect(evaluateAST(ast, { count: 42 })).toBe(42);
        });

        it('should evaluate user.name', () => {
            const ast = parseExpression('user.name');
            expect(evaluateAST(ast, { user: { name: 'Alice' } })).toBe('Alice');
        });

        it('should evaluate items.length', () => {
            const ast = parseExpression('items.length');
            expect(evaluateAST(ast, { items: [1, 2, 3] })).toBe(3);
        });

        it('should evaluate data.nested.deep.value', () => {
            const ast = parseExpression('data.nested.deep.value');
            expect(evaluateAST(ast, {
                data: { nested: { deep: { value: 'found' } } }
            })).toBe('found');
        });
    });

    describe('Negation', () => {
        it('should evaluate !isVisible', () => {
            const ast = parseExpression('!isVisible');
            expect(evaluateAST(ast, { isVisible: true })).toBe(false);
        });

        it('should evaluate !loading', () => {
            const ast = parseExpression('!loading');
            expect(evaluateAST(ast, { loading: false })).toBe(true);
        });

        it('should evaluate !!value', () => {
            const ast = parseExpression('!!value');
            expect(evaluateAST(ast, { value: 'truthy' })).toBe(true);
        });
    });

    describe('Comparison', () => {
        it('should evaluate count > 5', () => {
            const ast = parseExpression('count > 5');
            expect(evaluateAST(ast, { count: 10 })).toBe(true);
        });

        it('should evaluate status === "active"', () => {
            const ast = parseExpression('status === "active"');
            expect(evaluateAST(ast, { status: 'active' })).toBe(true);
        });

        it('should evaluate age >= 18 && age <= 65', () => {
            const ast = parseExpression('age >= 18 && age <= 65');
            expect(evaluateAST(ast, { age: 30 })).toBe(true);
            expect(evaluateAST(ast, { age: 70 })).toBe(false);
        });
    });

    describe('Ternary', () => {
        it('should evaluate isAdmin ? "Admin" : "User"', () => {
            const ast = parseExpression('isAdmin ? "Admin" : "User"');
            expect(evaluateAST(ast, { isAdmin: true })).toBe('Admin');
            expect(evaluateAST(ast, { isAdmin: false })).toBe('User');
        });

        it('should evaluate count === 0 ? "Empty" : count', () => {
            const ast = parseExpression('count === 0 ? "Empty" : count');
            expect(evaluateAST(ast, { count: 0 })).toBe('Empty');
            expect(evaluateAST(ast, { count: 5 })).toBe(5);
        });

        it('should evaluate nested ternary a ? b : c ? d : e', () => {
            const ast = parseExpression('a ? b : c ? d : e');
            expect(evaluateAST(ast, { a: true, b: 'B' })).toBe('B');
            expect(evaluateAST(ast, { a: false, c: true, d: 'D' })).toBe('D');
            expect(evaluateAST(ast, { a: false, c: false, e: 'E' })).toBe('E');
        });
    });

    describe('Logical', () => {
        it('should evaluate isLoading && hasData', () => {
            const ast = parseExpression('isLoading && hasData');
            expect(evaluateAST(ast, { isLoading: true, hasData: true })).toBe(true);
            expect(evaluateAST(ast, { isLoading: false, hasData: true })).toBe(false);
        });

        it('should evaluate error || defaultValue', () => {
            const ast = parseExpression('error || defaultValue');
            expect(evaluateAST(ast, { error: 'Error!', defaultValue: 'default' })).toBe('Error!');
            expect(evaluateAST(ast, { error: '', defaultValue: 'default' })).toBe('default');
        });

        it('should evaluate a && b || c && d', () => {
            const ast = parseExpression('a && b || c && d');
            expect(evaluateAST(ast, { a: true, b: true, c: false, d: false })).toBe(true);
            expect(evaluateAST(ast, { a: false, b: false, c: true, d: true })).toBe(true);
        });
    });

    describe('Arithmetic', () => {
        it('should evaluate price * quantity', () => {
            const ast = parseExpression('price * quantity');
            expect(evaluateAST(ast, { price: 10, quantity: 5 })).toBe(50);
        });

        it('should evaluate total + tax', () => {
            const ast = parseExpression('total + tax');
            expect(evaluateAST(ast, { total: 100, tax: 8 })).toBe(108);
        });

        it('should evaluate (a + b) * c', () => {
            const ast = parseExpression('(a + b) * c');
            expect(evaluateAST(ast, { a: 2, b: 3, c: 4 })).toBe(20);
        });
    });

    describe('Mixed expressions', () => {
        it('should evaluate items.length > 0 ? items[0].name : "None"', () => {
            const ast = parseExpression('items.length > 0 ? items[0].name : "None"');
            expect(evaluateAST(ast, {
                items: [{ name: 'First' }]
            })).toBe('First');
            expect(evaluateAST(ast, { items: [] })).toBe('None');
        });

        it('should evaluate !isLoading && data && data.length > 0', () => {
            const ast = parseExpression('!isLoading && data && data.length > 0');
            expect(evaluateAST(ast, {
                isLoading: false,
                data: [1, 2, 3]
            })).toBe(true);
            expect(evaluateAST(ast, {
                isLoading: true,
                data: [1, 2, 3]
            })).toBe(false);
        });
    });

    describe('With external()', () => {
        it('should evaluate external("store", "count")', () => {
            const ast = parseExpression('external("store", "count")');
            const external = (storeName, path) => {
                if (storeName === 'store' && path === 'count') return 42;
                return undefined;
            };
            expect(evaluateAST(ast, { external })).toBe(42);
        });

        it('should evaluate external("store", "user.name") || "Anonymous"', () => {
            const ast = parseExpression('external("store", "user.name") || "Anonymous"');
            const external = () => undefined;
            expect(evaluateAST(ast, { external })).toBe('Anonymous');
        });
    });
});

describe('Parity with new Function()', () => {
    // These tests verify that CSP-safe evaluation produces the same results
    // as new Function() for supported expression patterns

    const testExpressions = [
        { expr: '42', ctx: {}, expected: 42 },
        { expr: '"hello"', ctx: {}, expected: 'hello' },
        { expr: 'a + b', ctx: { a: 1, b: 2 }, expected: 3 },
        { expr: 'a * b + c', ctx: { a: 2, b: 3, c: 4 }, expected: 10 },
        { expr: 'a > b', ctx: { a: 5, b: 3 }, expected: true },
        { expr: 'a === b', ctx: { a: 'x', b: 'x' }, expected: true },
        { expr: '!flag', ctx: { flag: true }, expected: false },
        { expr: 'a && b', ctx: { a: true, b: false }, expected: false },
        { expr: 'a || b', ctx: { a: false, b: true }, expected: true },
        { expr: 'cond ? "yes" : "no"', ctx: { cond: true }, expected: 'yes' },
        { expr: 'obj.prop', ctx: { obj: { prop: 'value' } }, expected: 'value' },
        { expr: 'arr[0]', ctx: { arr: [1, 2, 3] }, expected: 1 },
    ];

    testExpressions.forEach(({ expr, ctx, expected }) => {
        it(`should match new Function() result for: ${expr}`, () => {
            // CSP-safe evaluation
            const ast = parseExpression(expr);
            const cspResult = evaluateAST(ast, ctx);

            // new Function() evaluation (for reference/parity check)
            const keys = Object.keys(ctx);
            const values = Object.values(ctx);
            const fnResult = new Function(...keys, `return ${expr}`)(...values);

            expect(cspResult).toBe(fnResult);
            expect(cspResult).toBe(expected);
        });
    });

    describe('Non-space whitespace handling', () => {
        it('should parse expression with tab characters', () => {
            const ast = parseExpression('a\t+\tb');
            expect(ast).toBeTruthy();
            const result = evaluateAST(ast, { a: 3, b: 5 });
            expect(result).toBe(8);
        });

        it('should parse expression with newline characters', () => {
            const ast = parseExpression('a\n>\n0');
            expect(ast).toBeTruthy();
            const result = evaluateAST(ast, { a: 5 });
            expect(result).toBe(true);
        });

        it('should parse expression with carriage return', () => {
            const ast = parseExpression('a\r\n+\r\nb');
            expect(ast).toBeTruthy();
            const result = evaluateAST(ast, { a: 10, b: 20 });
            expect(result).toBe(30);
        });
    });
});
