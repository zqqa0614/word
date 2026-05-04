const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

loadEnvFile(path.join(ROOT, '.env'));

const YOUDAO_APP_KEY = process.env.YOUDAO_APP_KEY;
const YOUDAO_APP_SECRET = process.env.YOUDAO_APP_SECRET;

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) return;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });
    res.end(JSON.stringify(payload));
}

function sendStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const safePath = url.pathname === '/' ? '/word.html' : decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(ROOT, safePath));

    const relativePath = path.relative(ROOT, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8'
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1024 * 20) {
                reject(new Error('请求内容过大'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error('请求格式错误'));
            }
        });
        req.on('error', reject);
    });
}

function truncate(text) {
    const chars = Array.from(text);
    if (chars.length <= 20) return text;
    return `${chars.slice(0, 10).join('')}${chars.length}${chars.slice(-10).join('')}`;
}

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function requestYoudao(query) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomUUID();
        const curtime = Math.floor(Date.now() / 1000).toString();
        const params = new URLSearchParams({
            q: query,
            from: 'en',
            to: 'zh-CHS',
            appKey: YOUDAO_APP_KEY,
            salt,
            sign: sha256(YOUDAO_APP_KEY + truncate(query) + salt + curtime + YOUDAO_APP_SECRET),
            signType: 'v3',
            curtime
        });

        const request = https.request({
            hostname: 'openapi.youdao.com',
            path: '/api',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(params.toString())
            },
            timeout: 10000
        }, response => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error('有道返回格式异常'));
                }
            });
        });

        request.on('timeout', () => {
            request.destroy(new Error('有道翻译请求超时'));
        });
        request.on('error', reject);
        request.write(params.toString());
        request.end();
    });
}

function pickChinese(data) {
    if (Array.isArray(data.basic?.explains) && data.basic.explains.length > 0) {
        return data.basic.explains.join('；');
    }
    if (Array.isArray(data.translation) && data.translation.length > 0) {
        return data.translation.join('；');
    }
    return '';
}

async function handleTranslate(req, res) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, message: '只支持 POST 请求' });
        return;
    }
    if (!YOUDAO_APP_KEY || !YOUDAO_APP_SECRET) {
        sendJson(res, 500, {
            ok: false,
            message: '请先在 .env 中配置 YOUDAO_APP_KEY 和 YOUDAO_APP_SECRET'
        });
        return;
    }

    try {
        const body = await readJsonBody(req);
        const query = String(body.q || '').trim();
        if (!query) {
            sendJson(res, 400, { ok: false, message: '请输入要翻译的单词' });
            return;
        }

        const data = await requestYoudao(query);
        if (data.errorCode !== '0') {
            sendJson(res, 502, {
                ok: false,
                message: `有道翻译失败，错误码：${data.errorCode || 'unknown'}`
            });
            return;
        }

        const chinese = pickChinese(data);
        if (!chinese) {
            sendJson(res, 502, { ok: false, message: '有道没有返回有效释义' });
            return;
        }

        sendJson(res, 200, {
            ok: true,
            english: query,
            chinese
        });
    } catch (err) {
        sendJson(res, 500, { ok: false, message: err.message || '翻译服务异常' });
    }
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/translate') {
        handleTranslate(req, res);
        return;
    }
    sendStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`单词记忆助手已启动：http://localhost:${PORT}`);
});
