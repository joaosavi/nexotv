'use strict';
const assert = require('assert');

// Async-capable test runner
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// --- Tests registered below ---

console.log('\n--- M3U Parser Tests ---');

const { parseM3U } = require('./src/parsers/m3uParser');

test('parses basic M3U_PLUS with tvg attributes', () => {
    const m3u = `#EXTM3U url-tvg="http://epg.example.com/epg.xml"
#EXTINF:-1 tvg-id="CNN" tvg-name="CNN HD" tvg-logo="http://logo.com/cnn.png" group-title="News",CNN HD
http://panel.example.com/live/user/pass/100.ts
#EXTINF:-1 tvg-id="ESPN" tvg-logo="http://logo.com/espn.png" group-title="Sports",ESPN
http://panel.example.com/live/user/pass/200.ts`;

    const result = parseM3U(m3u);
    assert.strictEqual(result.channels.length, 2);
    assert.strictEqual(result.epgUrl, 'http://epg.example.com/epg.xml');

    const cnn = result.channels[0];
    assert.strictEqual(cnn.name, 'CNN HD');
    assert.strictEqual(cnn.tvgId, 'CNN');
    assert.strictEqual(cnn.tvgName, 'CNN HD');
    assert.strictEqual(cnn.logo, 'http://logo.com/cnn.png');
    assert.strictEqual(cnn.group, 'News');
    assert.strictEqual(cnn.url, 'http://panel.example.com/live/user/pass/100.ts');
});

test('parses basic M3U without EXTINF attributes', () => {
    const m3u = `#EXTM3U
#EXTINF:-1,Channel One
http://example.com/ch1.m3u8
#EXTINF:-1,Channel Two
http://example.com/ch2.m3u8`;

    const result = parseM3U(m3u);
    assert.strictEqual(result.channels.length, 2);
    assert.strictEqual(result.epgUrl, null);
    assert.strictEqual(result.channels[0].name, 'Channel One');
    assert.strictEqual(result.channels[0].group, 'Uncategorized');
    assert.strictEqual(result.channels[0].tvgId, '');
});

test('skips EXTINF entries with no URL line', () => {
    const m3u = `#EXTM3U
#EXTINF:-1 group-title="News",CNN HD
http://example.com/cnn.ts
#EXTINF:-1 group-title="Sports",ESPN`;
    // ESPN has no URL line — must be skipped
    const result = parseM3U(m3u);
    assert.strictEqual(result.channels.length, 1);
});

test('handles CRLF line endings', () => {
    const m3u = `#EXTM3U\r\n#EXTINF:-1,Channel A\r\nhttp://example.com/a.ts\r\n`;
    const result = parseM3U(m3u);
    assert.strictEqual(result.channels.length, 1);
    assert.strictEqual(result.channels[0].url, 'http://example.com/a.ts');
});

test('handles empty or whitespace-only input', () => {
    assert.deepStrictEqual(parseM3U('').channels, []);
    assert.deepStrictEqual(parseM3U('   \n  ').channels, []);
});

test('prefers url-tvg over x-tvg-url in header', () => {
    const m3u = `#EXTM3U x-tvg-url="http://fallback.com/epg.xml" url-tvg="http://primary.com/epg.xml"
#EXTINF:-1,Test Channel
http://example.com/test.ts`;
    const result = parseM3U(m3u);
    assert.strictEqual(result.epgUrl, 'http://primary.com/epg.xml');
});

test('falls back to x-tvg-url when url-tvg absent', () => {
    const m3u = `#EXTM3U x-tvg-url="http://fallback.com/epg.xml"
#EXTINF:-1,Test Channel
http://example.com/test.ts`;
    const result = parseM3U(m3u);
    assert.strictEqual(result.epgUrl, 'http://fallback.com/epg.xml');
});

// Runner — executes after all synchronous test() registrations
async function runAll() {
    let passed = 0, failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (e) {
            console.error(`  ✗ ${name}: ${e.message}`);
            failed++;
        }
    }
    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

runAll();
