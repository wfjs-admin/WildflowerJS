/**
 * Custom Vitest Reporter that displays assertion counts
 *
 * Since Vitest browser mode doesn't track assertion counts in results,
 * we count static expect() calls from test files.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function countExpectsInFile(filePath) {
    try {
        const content = readFileSync(filePath, 'utf8');
        // Count expect( calls - this is a reasonable approximation
        const matches = content.match(/expect\s*\(/g);
        return matches ? matches.length : 0;
    } catch {
        return 0;
    }
}

function countTestsInTasks(tasks) {
    let count = 0;
    for (const task of tasks) {
        if (task.type === 'test') {
            count++;
        }
        if (task.tasks) {
            count += countTestsInTasks(task.tasks);
        }
    }
    return count;
}

export default class AssertionReporter {
    constructor() {
        this.stats = {
            totalAssertions: 0,
            testCount: 0,
            fileCount: 0
        };
    }

    onInit(ctx) {
        // Store vitest context for later use
        this.ctx = ctx;
    }

    onTestRunEnd() {
        // Get files from context
        if (this.ctx?.state?.getFiles) {
            const files = this.ctx.state.getFiles();
            this._printSummary(files);
        }
    }

    _printSummary(files = []) {
        // Count tests from task results
        let testCount = 0;
        let fileCount = 0;
        let totalAssertions = 0;

        for (const file of files) {
            if (file.tasks) {
                fileCount++;
                testCount += countTestsInTasks(file.tasks);
                // Count expect() calls from the source file
                if (file.filepath) {
                    totalAssertions += countExpectsInFile(file.filepath);
                }
            }
        }

        // Display summary with assertion count
        const line = '─'.repeat(60);
        console.log('\n' + line);
        console.log('📊 ASSERTION SUMMARY');
        console.log(`   Tests:      ${testCount}`);
        console.log(`   Assertions: ${totalAssertions} (static count)`);
        console.log(`   Files:      ${fileCount}`);
        if (testCount > 0) {
            console.log(`   Avg/Test:   ${(totalAssertions / testCount).toFixed(1)}`);
        }
        console.log(line);
    }
}
