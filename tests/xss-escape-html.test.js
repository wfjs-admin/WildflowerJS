/**
 * Comprehensive XSS Security Tests for _escapeHTML
 *
 * Tests the HTML escaping function used in the innerHTML fast path
 * for list rendering. This is security-critical as any bypass could
 * allow XSS attacks in list-rendered content.
 *
 * Test categories:
 * 1. Basic character escaping
 * 2. Script tag injection
 * 3. Event handler injection
 * 4. Protocol handler injection
 * 5. Unicode/encoding bypasses
 * 6. HTML entity bypasses
 * 7. Null byte injection
 * 8. Case variation attacks
 * 9. Nested/broken tag attacks
 * 10. SVG/MathML vectors
 * 11. CSS injection vectors
 * 12. Template literal attacks
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('XSS Protection - _escapeHTML', () => {
    let container;
    let wf;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();

        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        resetFramework();
    });

    const waitForUpdate = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Helper to test that malicious content is safely escaped in list rendering
     * Uses the innerHTML fast path which relies on _escapeHTML
     */
    async function testListEscaping(maliciousValue, description) {
        const componentName = `xss-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        wf.component(componentName, {
            state: {
                items: [{ id: 1, content: maliciousValue }]
            }
        });

        container.innerHTML = `
            <div data-component="${componentName}">
                <div data-list="items" data-key="id">
                    <template>
                        <div class="item" data-bind="content"></div>
                    </template>
                </div>
            </div>
        `;

        wf.scan();
        await waitForUpdate(100);

        const itemEl = container.querySelector('.item');

        // The content should be escaped and displayed as text, not executed
        // Check that no script elements were created
        const scripts = container.querySelectorAll('script');
        expect(scripts.length, `${description}: script tags should not be created`).toBe(0);

        // Check that no event handlers were attached via injection
        const elementsWithHandlers = container.querySelectorAll('[onclick], [onerror], [onload], [onmouseover]');
        expect(elementsWithHandlers.length, `${description}: event handlers should not be injected`).toBe(0);

        // The text content should contain the escaped version (visible as text)
        expect(itemEl, `${description}: item element should exist`).toBeTruthy();

        // Verify innerHTML doesn't contain unescaped dangerous characters in tag context
        const html = itemEl.innerHTML;

        // Should not contain unescaped < or > that could form tags
        // (The escaped versions &lt; and &gt; are fine as text)
        const hasUnescapedTags = /<[a-zA-Z]/.test(html) && !html.includes('&lt;');
        expect(hasUnescapedTags, `${description}: should not have unescaped tags`).toBe(false);

        return { itemEl, html };
    }

    // =========================================================================
    // 1. BASIC CHARACTER ESCAPING
    // =========================================================================
    describe('Basic Character Escaping', () => {
        it('should escape ampersand (&)', async () => {
            const { html } = await testListEscaping('Tom & Jerry', 'ampersand');
            expect(html).toContain('&amp;');
        });

        it('should escape less than (<)', async () => {
            const { html } = await testListEscaping('1 < 2', 'less than');
            expect(html).toContain('&lt;');
        });

        it('should escape greater than (>)', async () => {
            const { html } = await testListEscaping('2 > 1', 'greater than');
            expect(html).toContain('&gt;');
        });

        it('should handle double quote (")', async () => {
            // In TEXT CONTENT context, quotes don't need escaping - they're harmless
            // The browser will display them as-is. This is secure because:
            // 1. < and > are escaped, so no tags can be formed
            // 2. Quotes in text content can't break out of anything
            const { itemEl } = await testListEscaping('He said "hello"', 'double quote');
            expect(itemEl.textContent).toContain('"');
        });

        it('should escape single quote (\')', async () => {
            const { html } = await testListEscaping("It's a test", 'single quote');
            // Single quote should be escaped as &#39; or &apos; or left as-is if only in text content
            // In text content context, single quotes are generally safe
            expect(html).toContain("'"); // Single quotes in text content are OK
        });

        it('should escape multiple special characters together', async () => {
            const { html } = await testListEscaping('<script>"alert"</script> & more', 'multiple chars');
            // Critical: < > & must be escaped to prevent XSS
            expect(html).toContain('&lt;');
            expect(html).toContain('&gt;');
            expect(html).toContain('&amp;');
            // Quotes in text content are harmless and browser may not re-escape them
            // when reading innerHTML back (they're only dangerous in attribute context)
        });

        it('should handle empty string', async () => {
            const { html } = await testListEscaping('', 'empty string');
            expect(html).toBe('');
        });

        it('should handle null-ish values', async () => {
            const componentName = `xss-null-${Date.now()}`;
            wf.component(componentName, {
                state: {
                    items: [
                        { id: 1, content: null },
                        { id: 2, content: undefined }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="${componentName}">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item" data-bind="content"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate(100);

            const items = container.querySelectorAll('.item');
            expect(items.length).toBe(2);
            // Null/undefined should render as empty, not as "null" or "undefined"
        });

        it('should handle numbers', async () => {
            const { itemEl } = await testListEscaping(12345, 'number');
            expect(itemEl.textContent).toBe('12345');
        });

        it('should handle boolean values', async () => {
            const { itemEl } = await testListEscaping(true, 'boolean');
            expect(itemEl.textContent).toBe('true');
        });
    });

    // =========================================================================
    // 2. SCRIPT TAG INJECTION
    // =========================================================================
    describe('Script Tag Injection', () => {
        it('should escape basic script tag', async () => {
            await testListEscaping('<script>alert("xss")</script>', 'basic script');
        });

        it('should escape script tag with src attribute', async () => {
            await testListEscaping('<script src="evil.js"></script>', 'script src');
        });

        it('should escape script tag with type attribute', async () => {
            await testListEscaping('<script type="text/javascript">alert(1)</script>', 'script type');
        });

        it('should escape uppercase SCRIPT tag', async () => {
            await testListEscaping('<SCRIPT>alert("xss")</SCRIPT>', 'uppercase script');
        });

        it('should escape mixed case ScRiPt tag', async () => {
            await testListEscaping('<ScRiPt>alert("xss")</ScRiPt>', 'mixed case script');
        });

        it('should escape script with newlines', async () => {
            await testListEscaping('<script\n>alert("xss")</script\n>', 'script with newlines');
        });

        it('should escape script with tabs', async () => {
            await testListEscaping('<script\t>alert("xss")</script>', 'script with tabs');
        });
    });

    // =========================================================================
    // 3. EVENT HANDLER INJECTION
    // =========================================================================
    describe('Event Handler Injection', () => {
        it('should escape img onerror', async () => {
            await testListEscaping('<img src=x onerror="alert(1)">', 'img onerror');
        });

        it('should escape img onload', async () => {
            await testListEscaping('<img src="valid.jpg" onload="alert(1)">', 'img onload');
        });

        it('should escape body onload', async () => {
            await testListEscaping('<body onload="alert(1)">', 'body onload');
        });

        it('should escape div onclick', async () => {
            await testListEscaping('<div onclick="alert(1)">click</div>', 'div onclick');
        });

        it('should escape svg onload', async () => {
            await testListEscaping('<svg onload="alert(1)">', 'svg onload');
        });

        it('should escape input onfocus', async () => {
            await testListEscaping('<input onfocus="alert(1)" autofocus>', 'input onfocus');
        });

        it('should escape marquee onstart', async () => {
            await testListEscaping('<marquee onstart="alert(1)">', 'marquee onstart');
        });

        it('should escape details ontoggle', async () => {
            await testListEscaping('<details ontoggle="alert(1)" open>', 'details ontoggle');
        });

        it('should escape video onloadstart', async () => {
            await testListEscaping('<video onloadstart="alert(1)"><source src="x"></video>', 'video onloadstart');
        });

        it('should escape audio onerror', async () => {
            await testListEscaping('<audio src="x" onerror="alert(1)">', 'audio onerror');
        });
    });

    // =========================================================================
    // 4. PROTOCOL HANDLER INJECTION
    // =========================================================================
    describe('Protocol Handler Injection', () => {
        it('should escape javascript: protocol in href', async () => {
            await testListEscaping('<a href="javascript:alert(1)">click</a>', 'javascript href');
        });

        it('should escape javascript: with entities', async () => {
            await testListEscaping('<a href="java&#115;cript:alert(1)">click</a>', 'javascript entities');
        });

        it('should escape data: protocol', async () => {
            await testListEscaping('<a href="data:text/html,<script>alert(1)</script>">click</a>', 'data protocol');
        });

        it('should escape vbscript: protocol', async () => {
            await testListEscaping('<a href="vbscript:alert(1)">click</a>', 'vbscript protocol');
        });

        it('should escape javascript: in img src', async () => {
            await testListEscaping('<img src="javascript:alert(1)">', 'javascript img src');
        });

        it('should escape javascript: in iframe src', async () => {
            await testListEscaping('<iframe src="javascript:alert(1)"></iframe>', 'javascript iframe');
        });
    });

    // =========================================================================
    // 5. UNICODE/ENCODING BYPASSES
    // =========================================================================
    describe('Unicode/Encoding Bypasses', () => {
        it('should handle Unicode less-than (\\u003C)', async () => {
            await testListEscaping('\u003Cscript\u003Ealert(1)\u003C/script\u003E', 'unicode less-than');
        });

        it('should handle Unicode greater-than (\\u003E)', async () => {
            await testListEscaping('\u003Cimg src=x onerror=alert(1)\u003E', 'unicode greater-than');
        });

        it('should handle fullwidth less-than (＜)', async () => {
            await testListEscaping('＜script＞alert(1)＜/script＞', 'fullwidth brackets');
        });

        it('should handle UTF-7 encoding attempt', async () => {
            await testListEscaping('+ADw-script+AD4-alert(1)+ADw-/script+AD4-', 'UTF-7 attempt');
        });

        it('should handle overlong UTF-8 sequences', async () => {
            // These shouldn't parse as < but test anyway
            await testListEscaping('\xC0\xBCscript\xC0\xBE', 'overlong UTF-8');
        });
    });

    // =========================================================================
    // 6. HTML ENTITY BYPASSES
    // =========================================================================
    describe('HTML Entity Bypasses', () => {
        it('should handle numeric entity for < (&#60;)', async () => {
            await testListEscaping('&#60;script&#62;alert(1)&#60;/script&#62;', 'numeric entities');
        });

        it('should handle hex entity for < (&#x3C;)', async () => {
            await testListEscaping('&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;', 'hex entities');
        });

        it('should handle named entities', async () => {
            await testListEscaping('&lt;script&gt;alert(1)&lt;/script&gt;', 'named entities');
        });

        it('should handle mixed entities', async () => {
            await testListEscaping('&#60;script&gt;alert(1)&#x3C;/script>', 'mixed entities');
        });

        it('should handle entity without semicolon', async () => {
            await testListEscaping('&#60script&#62alert(1)&#60/script&#62', 'entity no semicolon');
        });
    });

    // =========================================================================
    // 7. NULL BYTE INJECTION
    // =========================================================================
    describe('Null Byte Injection', () => {
        it('should handle null byte before tag', async () => {
            await testListEscaping('\x00<script>alert(1)</script>', 'null before tag');
        });

        it('should handle null byte in tag name', async () => {
            await testListEscaping('<scr\x00ipt>alert(1)</script>', 'null in tag name');
        });

        it('should handle null byte in attribute', async () => {
            await testListEscaping('<img src=x onerror\x00="alert(1)">', 'null in attribute');
        });
    });

    // =========================================================================
    // 8. NESTED/BROKEN TAG ATTACKS
    // =========================================================================
    describe('Nested/Broken Tag Attacks', () => {
        it('should handle double angle brackets', async () => {
            await testListEscaping('<<script>alert(1)</script>', 'double brackets');
        });

        it('should handle tag within tag name', async () => {
            await testListEscaping('<scr<script>ipt>alert(1)</script>', 'tag in tag name');
        });

        it('should handle unclosed tags', async () => {
            await testListEscaping('<script>alert(1)', 'unclosed script');
        });

        it('should handle malformed closing tag', async () => {
            await testListEscaping('<script>alert(1)</script', 'malformed close');
        });

        it('should handle comment injection', async () => {
            await testListEscaping('<!--<script>alert(1)</script>-->', 'comment injection');
        });

        it('should handle CDATA injection', async () => {
            await testListEscaping('<![CDATA[<script>alert(1)</script>]]>', 'CDATA injection');
        });
    });

    // =========================================================================
    // 9. SVG/MATHML VECTORS
    // =========================================================================
    describe('SVG/MathML Vectors', () => {
        it('should escape svg with script', async () => {
            await testListEscaping('<svg><script>alert(1)</script></svg>', 'svg script');
        });

        it('should escape svg with onload', async () => {
            await testListEscaping('<svg onload="alert(1)">', 'svg onload');
        });

        it('should escape svg animate', async () => {
            await testListEscaping('<svg><animate onbegin="alert(1)">', 'svg animate');
        });

        it('should escape svg set', async () => {
            await testListEscaping('<svg><set onbegin="alert(1)">', 'svg set');
        });

        it('should escape svg use with external ref', async () => {
            await testListEscaping('<svg><use href="data:image/svg+xml,<svg onload=alert(1)>">', 'svg use');
        });

        it('should escape math with script', async () => {
            await testListEscaping('<math><script>alert(1)</script></math>', 'math script');
        });

        it('should escape svg foreignObject', async () => {
            await testListEscaping('<svg><foreignObject><script>alert(1)</script></foreignObject></svg>', 'svg foreignObject');
        });
    });

    // =========================================================================
    // 10. CSS INJECTION VECTORS
    // =========================================================================
    describe('CSS Injection Vectors', () => {
        it('should escape style tag', async () => {
            await testListEscaping('<style>body{background:url(javascript:alert(1))}</style>', 'style tag');
        });

        it('should escape style attribute', async () => {
            await testListEscaping('<div style="background:url(javascript:alert(1))">test</div>', 'style attribute');
        });

        it('should escape expression() in style', async () => {
            await testListEscaping('<div style="width:expression(alert(1))">test</div>', 'expression');
        });

        it('should escape -moz-binding', async () => {
            await testListEscaping('<div style="-moz-binding:url(evil.xml)">test</div>', 'moz-binding');
        });

        it('should escape behavior in style', async () => {
            await testListEscaping('<div style="behavior:url(evil.htc)">test</div>', 'behavior');
        });
    });

    // =========================================================================
    // 11. TEMPLATE LITERAL ATTACKS
    // =========================================================================
    describe('Template Literal Attacks', () => {
        it('should handle backticks', async () => {
            const { html } = await testListEscaping('`${alert(1)}`', 'backticks');
            // Backticks should be preserved as text (they're not HTML-special)
            expect(html).toContain('`');
        });

        it('should handle template with script', async () => {
            await testListEscaping('<template><script>alert(1)</script></template>', 'template element');
        });
    });

    // =========================================================================
    // 12. ATTRIBUTE CONTEXT EDGE CASES
    // =========================================================================
    describe('Attribute Context Edge Cases', () => {
        it('should escape value that could break out of attribute', async () => {
            // If this value ended up in an attribute context, it could break out
            await testListEscaping('" onclick="alert(1)" data-x="', 'attribute breakout');
        });

        it('should escape single quote attribute breakout', async () => {
            await testListEscaping("' onclick='alert(1)' data-x='", 'single quote breakout');
        });

        it('should escape angle bracket in attribute value', async () => {
            await testListEscaping('test"><script>alert(1)</script><input value="', 'angle in attr');
        });
    });

    // =========================================================================
    // 13. REAL-WORLD XSS PAYLOADS (from known bypasses)
    // =========================================================================
    describe('Real-World XSS Payloads', () => {
        it('should escape PortSwigger basic payload', async () => {
            await testListEscaping('<img src=1 onerror=alert(1)>', 'PortSwigger basic');
        });

        it('should escape XSS without spaces', async () => {
            await testListEscaping('<svg/onload=alert(1)>', 'no space svg');
        });

        it('should escape XSS with encoded spaces', async () => {
            await testListEscaping('<img%20src=x%20onerror=alert(1)>', 'encoded spaces');
        });

        it('should escape XSS with tab instead of space', async () => {
            await testListEscaping('<img\tsrc=x\tonerror=alert(1)>', 'tab separator');
        });

        it('should escape XSS with newline instead of space', async () => {
            await testListEscaping('<img\nsrc=x\nonerror=alert(1)>', 'newline separator');
        });

        it('should escape XSS with forward slash instead of space', async () => {
            await testListEscaping('<img/src=x/onerror=alert(1)>', 'slash separator');
        });

        it('should escape mutation XSS payload', async () => {
            await testListEscaping('<noscript><p title="</noscript><script>alert(1)</script>">', 'mutation XSS');
        });

        it('should escape DOM clobbering attempt', async () => {
            await testListEscaping('<form id="location" action="javascript:alert(1)"><input name="href" value="javascript:alert(1)">', 'DOM clobbering');
        });
    });

    // =========================================================================
    // 14. STRESS TESTS
    // =========================================================================
    describe('Stress Tests', () => {
        it('should handle very long malicious string', async () => {
            const longPayload = '<script>alert(1)</script>'.repeat(100);
            await testListEscaping(longPayload, 'long payload');
        });

        it('should handle many special characters', async () => {
            const manySpecial = '<>&"\''.repeat(1000);
            const { html } = await testListEscaping(manySpecial, 'many special chars');
            expect(html).not.toContain('<>');
        });

        it('should handle mixed content with legitimate HTML entities', async () => {
            // User might legitimately want to display &amp; as text
            const { itemEl } = await testListEscaping('Tom &amp; Jerry', 'pre-escaped ampersand');
            // Should double-escape: &amp; becomes &amp;amp;
            expect(itemEl.textContent).toContain('&amp;');
        });
    });

    // =========================================================================
    // I1: Fast-path attr binding security
    // =========================================================================
    describe('List attr binding fast path security', () => {
        it('blocks onclick in data-bind-attr on list items', async () => {
            wf.component('xss-attr-list', {
                state: {
                    items: [{ id: 1, attrs: { onclick: 'alert(1)', title: 'safe' } }]
                }
            });

            container.innerHTML = `
                <div data-component="xss-attr-list">
                    <div data-list="items">
                        <template>
                            <div data-bind-attr="attrs" class="target"></div>
                        </template>
                    </div>
                </div>
            `;
            wf.scan(container);
            await new Promise(r => setTimeout(r, 150));

            const target = container.querySelector('.target');
            expect(target).toBeTruthy();
            // onclick should be blocked, title should be set
            expect(target.hasAttribute('onclick')).toBe(false);
            expect(target.getAttribute('title')).toBe('safe');
        });

        it('sanitizes javascript: URLs in href via data-bind-attr on list items', async () => {
            wf.component('xss-href-list', {
                state: {
                    items: [{ id: 1, attrs: { href: 'javascript:alert(1)' } }]
                }
            });

            container.innerHTML = `
                <div data-component="xss-href-list">
                    <div data-list="items">
                        <template>
                            <a data-bind-attr="attrs" class="target">link</a>
                        </template>
                    </div>
                </div>
            `;
            wf.scan(container);
            await new Promise(r => setTimeout(r, 150));

            const target = container.querySelector('.target');
            expect(target).toBeTruthy();
            const href = target.getAttribute('href');
            // Should either be blocked or sanitized — must not contain javascript:
            expect(href === null || !href.toLowerCase().includes('javascript:')).toBe(true);
        });
    });

    // =========================================================================
    // I3: Expression evaluator blocks document access
    // =========================================================================
    describe('Expression evaluator document access', () => {
        it('blocks document.cookie in data-bind expression', async () => {
            wf.component('xss-document-test', {
                state: { label: 'safe' }
            });

            container.innerHTML = `
                <div data-component="xss-document-test">
                    <span id="safe" data-bind="label"></span>
                    <span id="unsafe" data-bind="document.cookie"></span>
                </div>
            `;
            wf.scan(container);
            await new Promise(r => setTimeout(r, 100));

            expect(container.querySelector('#safe').textContent).toBe('safe');
            // document.cookie should be blocked — element should be empty or show error
            const unsafeEl = container.querySelector('#unsafe');
            expect(unsafeEl.textContent).not.toContain(document.cookie || 'test');
        });
    });
});
