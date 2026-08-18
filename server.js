'use strict';

/**
 * MIDAD Platform - zero-dependency static file server.
 * Serves everything under ./public and binds to the PORT provided by Railway.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// 8080 matches the target port on the generated Railway domain, so the app is
// reachable even when no PORT variable is set on the service.
const PORT = Number(process.env.PORT) || 8080;
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

function cacheControl(ext, versioned) {
    // HTML must never be served stale, or a deploy stays invisible.
    if (ext === '.html') return 'no-cache';
    // scripts/version-assets.mjs stamps asset URLs with a content hash, so a
    // versioned URL can only ever mean one specific file.
    if (versioned) return 'public, max-age=31536000, immutable';
    // Anything unstamped still revalidates against the ETag below.
    return 'public, max-age=300';
}

async function sendFile(req, res, filePath, { statusCode = 200, versioned = false } = {}) {
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;

    const headers = {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': cacheControl(ext, versioned),
        'Last-Modified': stat.mtime.toUTCString(),
        ETag: etag,
        'X-Content-Type-Options': 'nosniff'
    };

    // Let a client with an unchanged copy skip the download.
    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(statusCode, headers);

    if (req.method === 'HEAD') {
        res.end();
        return;
    }
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

    const url = req.url || '/';
    const filePath = resolveRequestPath(url);
    if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
    }

    const versioned = /[?&]v=[a-f0-9]+/.test(url);

    try {
        let target = filePath;
        const stat = await fsp.stat(target).catch(() => null);
        if (stat && stat.isDirectory()) target = path.join(target, 'index.html');

        await sendFile(req, res, target, { versioned });
    } catch {
        // Unknown path -> fall back to the single-page app entry point.
        try {
            await sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), { statusCode: 404 });
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
        // Idle keep-alive sockets would otherwise hold the server open until the
        // platform kills the container, which surfaces as a failed shutdown.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        // Last resort so shutdown can never hang.
        setTimeout(() => process.exit(0), 5000).unref();
    });
}
