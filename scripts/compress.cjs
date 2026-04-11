/**
 * Post-build compression script
 * Creates gzip and brotli compressed versions of minified bundles
 */

const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');

// Try to load brotli - it may not be installed
let brotli;
try {
    brotli = require('brotli');
} catch (e) {
    console.log('Note: brotli package not installed, skipping brotli compression');
}

const distDir = path.join(__dirname, '..', 'dist');

// Find all .min.js files
const minFiles = fs.readdirSync(distDir)
    .filter(f => f.endsWith('.min.js'))
    .map(f => path.join(distDir, f));

console.log(`\nCompressing ${minFiles.length} minified bundles...\n`);

for (const filePath of minFiles) {
    const content = fs.readFileSync(filePath);
    const basename = path.basename(filePath);

    // Gzip compression
    const gzipped = gzipSync(content, { level: 9 });
    const gzipPath = filePath + '.gz';
    fs.writeFileSync(gzipPath, gzipped);
    const gzSize = (gzipped.length / 1024).toFixed(2);

    // Brotli compression (if available)
    let brSize = 'N/A';
    if (brotli) {
        const compressed = brotli.compress(content, {
            mode: 1, // Text mode
            quality: 11 // Maximum compression
        });
        if (compressed) {
            const brotliPath = filePath + '.br';
            fs.writeFileSync(brotliPath, Buffer.from(compressed));
            brSize = (compressed.length / 1024).toFixed(2);
        }
    }

    const origSize = (content.length / 1024).toFixed(2);
    console.log(`${basename}`);
    console.log(`   Original: ${origSize} KB → Gzip: ${gzSize} KB, Brotli: ${brSize} KB`);
}

console.log('\nCompression complete!');
