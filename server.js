'use strict';

/**
 * MIDAD Platform - zero-dependency static file server.
 * Serves everything under ./public and binds to the PORT provided by Railway.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf'
};

function resolveRequestPath(urlPath) {
    // Decode, strip query/hash, and keep the resolved path inside PUBLIC_DIR.
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
    } catch {
        return null;
    }

    if (decoded === '/' || decoded === '') decoded = '/index.html';

    const resolved = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize(decoded));
    if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
        return null; // path traversal attempt
    }
    return resolved;
}

async function sendFile(res, filePath, statusCode = 200) {
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';

    res.writeHead(statusCode, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        // HTML is revalidated every time so deploys show up immediately.
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
    });

    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
    }

    // Health check endpoint used by Railway.
    if (req.url === '/healthz' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok', service: 'midad-platform', uptime: process.uptime() }));
        return;
    }

    const filePath = resolveRequestPath(req.url || '/');
    if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
    }

    try {
        let target = filePath;
        const stat = await fsp.stat(target).catch(() => null);
        if (stat && stat.isDirectory()) target = path.join(target, 'index.html');

        await sendFile(res, target);
    } catch {
        // Unknown path -> fall back to the single-page app entry point.
        try {
            await sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 404);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
        }
    }
});

server.listen(PORT, HOST, () => {
    console.log(`MIDAD platform running on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        console.log(`Received ${signal}, shutting down.`);
        server.close(() => process.exit(0));
    });
}
