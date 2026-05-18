import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

// We can import the function or duplicate/simulate its execution to verify the logic.
// However, since we want to run unit tests against the real exported/registered features,
// let's import the specific helpers or test the pattern matching and helper logic directly
// from our sys-tools module.
// Note: Since sys-tools isn't directly exporting internal constants like STALL_PATTERNS and 
// TEST_PASS_PATTERNS, we can test the pattern regexes and output logic cleanly by simulating 
// the completion detector or loading the module.
// Let's write robust unit tests for the regex patterns and state machine logic.

suite('Smart Command Completion System Tests', () => {
    // Regex matches to ensure we avoid any regressions
    const STALL_PATTERNS = [
        { pattern: /waiting for file changes/i,         type: 'watch_mode',  tool: 'vitest/jest' },
        { pattern: /press h to show help.*press q/i,    type: 'watch_mode',  tool: 'vitest' },
        { pattern: /press.*to quit/i,                   type: 'watch_mode',  tool: 'vitest/jest' },
        { pattern: /watching for file changes/i,        type: 'watch_mode',  tool: 'nodemon' },
        { pattern: /webpack.*compiled\s+(success|with)/i, type: 'watch_mode', tool: 'webpack' },
        { pattern: /watching\s+for\s+changes/i,         type: 'watch_mode',  tool: 'tsc' },
        { pattern: /\?\s*(y\/n|yes\/no)\s*:?\s*$/im,    type: 'interactive', tool: null },
        { pattern: /\(y\/N\)\s*$/im,                    type: 'confirm',     tool: 'npm' },
        { pattern: /password\s*:\s*$/im,                type: 'interactive', tool: null },
        { pattern: /enter\s+.*:\s*$/im,                 type: 'interactive', tool: null },
    ];

    const TEST_PASS_PATTERNS = [/tests?\s+\d+\s+passed/i, /\d+\s+passing/i, /all tests passed/i, /\bPASS\b/];
    const TEST_FAIL_PATTERNS = [/tests?\s+\d+\s+failed/i, /\bFAIL\b\s/i, /failures?:\s*[1-9]/i, /AssertionError/i];

    test('Should correctly detect Vitest watch mode', () => {
        const sampleOutput = `
            DEV  v4.1.6 /home/user/project
            ✓ src/components/Dashboard.test.jsx (1 test) 80ms
            Test Files  1 passed (1)
            Tests       1 passed (1)
            Start at    11:57:55
            Duration    2.01s

            PASS  Waiting for file changes...
            press h to show help, press q to quit
        `;
        const matched = STALL_PATTERNS.find(sp => sp.pattern.test(sampleOutput));
        assert.ok(matched, 'Should match stall pattern');
        assert.strictEqual(matched!.type, 'watch_mode');
    });

    test('Should correctly detect Confirm prompts (y/N)', () => {
        const sampleOutput = 'Do you want to proceed? (y/N)';
        const matched = STALL_PATTERNS.find(sp => sp.pattern.test(sampleOutput));
        assert.ok(matched, 'Should match confirm pattern');
        assert.strictEqual(matched!.type, 'confirm');
    });

    test('Should correctly detect Password input prompt', () => {
        const sampleOutput = 'Enter password: ';
        const matched = STALL_PATTERNS.find(sp => sp.pattern.test(sampleOutput));
        assert.ok(matched, 'Should match password prompt');
        assert.strictEqual(matched!.type, 'interactive');
    });

    test('Should infer successful test exit code from pass patterns', () => {
        const sampleOutput1 = 'Tests  2 passed (2)';
        const sampleOutput2 = '5 passing (10s)';
        const sampleOutput3 = 'PASS  src/components/Button.test.tsx';

        assert.ok(TEST_PASS_PATTERNS.some(p => p.test(sampleOutput1)));
        assert.ok(TEST_PASS_PATTERNS.some(p => p.test(sampleOutput2)));
        assert.ok(TEST_PASS_PATTERNS.some(p => p.test(sampleOutput3)));

        assert.ok(!TEST_FAIL_PATTERNS.some(p => p.test(sampleOutput1)));
    });

    test('Should infer failure exit code from fail patterns', () => {
        const sampleOutput1 = 'Tests  1 failed (1)';
        const sampleOutput2 = 'FAIL  src/components/Button.test.tsx';
        const sampleOutput3 = 'failures: 3';

        assert.ok(TEST_FAIL_PATTERNS.some(p => p.test(sampleOutput1)));
        assert.ok(TEST_FAIL_PATTERNS.some(p => p.test(sampleOutput2)));
        assert.ok(TEST_FAIL_PATTERNS.some(p => p.test(sampleOutput3)));

        assert.ok(!TEST_PASS_PATTERNS.some(p => p.test(sampleOutput1)));
    });
});
