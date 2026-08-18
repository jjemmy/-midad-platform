#!/usr/bin/env node
/**
 * Stamp every /assets/... reference in the HTML with a hash of the file's contents.
 *
 * A browser that has cached midad-logo.webp will keep serving it for as long as the
 * cache header allows, so a redeploy alone does not update it. Hashing the URL means
 * changed files arrive under a new URL and are fetched immediately, while unchanged
 * ones stay cached. Run this after touching anything in public/assets.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'public', 'assets');
const htmlFile = path.join(root, 'public', 'index.html');

const html = readFileSync(htmlFile, 'utf8');
let out = html;
const report = [];

for (const name of readdirSync(assetsDir).sort()) {
    const hash = createHash('sha256')
        .update(readFileSync(path.join(assetsDir, name)))
        .digest('hex')
        .slice(0, 8);

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`/assets/${escaped}(\\?v=[a-f0-9]+)?`, 'g');

    let hits = 0;
    out = out.replace(pattern, () => {
        hits += 1;
        return `/assets/${name}?v=${hash}`;
    });
    report.push({ asset: name, hash, refs: hits });
}

if (out !== html) writeFileSync(htmlFile, out);

for (const r of report) {
    const note = r.refs === 0 ? '(not referenced)' : `${r.refs} ref(s)`;
    console.log(`${r.hash}  ${r.asset.padEnd(24)} ${note}`);
}
console.log(out === html ? '\nindex.html already up to date' : '\nindex.html updated');
