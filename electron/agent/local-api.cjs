const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = Number(process.env.FISCOAI_AGENT_PORT || 4790);
const APP_DIR = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || process.cwd(), 'AppData', 'Roaming'), 'FiscoAI');
const TOKEN_FILE = path.join(APP_DIR, 'agent-token.txt');
const CONFIG_FILE = path.join(APP_DIR, 'agent-config.json');

async function ensureToken() {
  await fsp.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  try {
    const existing = (await fsp.readFile(TOKEN_FILE, 'utf8')).trim();
    if (existing) return existing;
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  await fsp.writeFile(TOKEN_FILE, token, { encoding: 'utf8' });
  return token;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': 'http://127.0.0.1',
    'access-control-allow-headers': 'content-type, x-fiscoai-agent-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 12 * 1024 * 1024) {
        reject(new Error('Payload excede o limite de 12 MB.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function walkXml(folder, recursive = true, limit = 10000) {
  const result = [];
  async function visit(current) {
    if (result.length >= limit) return;
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= limit) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && recursive) {
        await visit(full);
      } else if (entry.isFile() && /\.xml$/i.test(entry.name)) {
        result.push(full);
      }
    }
  }
  await visit(folder);
  return result;
}

async function readXmlFiles(paths) {
  const files = [];
  for (const filePath of paths) {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) continue;
      files.push({
        name: path.basename(filePath),
        path: filePath,
        xml: await fsp.readFile(filePath, 'utf8'),
        size: stat.size,
      });
    } catch (error) {
      files.push({ name: path.basename(filePath), path: filePath, error: error.message });
    }
  }
  return files;
}

function safePath(input) {
  return path.resolve(String(input || ''));
}

function createLocalAgentApi({ getMainWindow, getPort, port }) {
  let server;
  let token;

  async function invokeRenderer(method, args = []) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) throw new Error('Janela do FiscoAI ainda não está disponível.');
    const script = `(() => {
      const api = window.__FISCOAI_AGENT__;
      if (!api || typeof api[${JSON.stringify(method)}] !== 'function') {
        throw new Error('Ponte do agente ainda não foi inicializada pelo FiscoAI.');
      }
      return api[${JSON.stringify(method)}](...${JSON.stringify(args)});
    })()`;
    return await win.webContents.executeJavaScript(script, true);
  }

  async function handle(req, res) {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});
    const url = new URL(req.url, `http://127.0.0.1:${getPort()}`);

    if (url.pathname === '/agent/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'FiscoAI Agent API', version: 1, port: getPort() });
    }

    const supplied = String(req.headers['x-fiscoai-agent-token'] || '');
    if (!token || supplied !== token) return sendJson(res, 401, { ok: false, error: 'Token do agente inválido.' });

    try {
      if (url.pathname === '/agent/info' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          service: 'FiscoAI Agent API',
          version: 1,
          bind: '127.0.0.1',
          port: getPort(),
          tokenFile: TOKEN_FILE,
          capabilities: ['scan_xml', 'import_xml', 'get_archive', 'export_fiscal_report'],
        });
      }

      if (url.pathname === '/agent/xmls/scan' && req.method === 'POST') {
        const body = await readJson(req);
        const folder = safePath(body.folder);
        const recursive = body.recursive !== false;
        if (!folder || !fs.existsSync(folder)) return sendJson(res, 400, { ok: false, error: 'Pasta não encontrada.' });
        const files = await walkXml(folder, recursive, Number(body.limit || 10000));
        return sendJson(res, 200, {
          ok: true,
          folder,
          recursive,
          count: files.length,
          files: files.map((p) => ({ path: p, name: path.basename(p) })),
        });
      }

      if (url.pathname === '/agent/xmls/import' && req.method === 'POST') {
        const body = await readJson(req);
        const folder = safePath(body.folder);
        if (!folder || !fs.existsSync(folder)) return sendJson(res, 400, { ok: false, error: 'Pasta não encontrada.' });
        const paths = await walkXml(folder, body.recursive !== false, Number(body.limit || 10000));
        const files = await readXmlFiles(paths);
        const result = await invokeRenderer('importXmlBatch', [files]);
        return sendJson(res, 200, { ok: true, folder, found: paths.length, result });
      }

      if (url.pathname === '/agent/archive' && req.method === 'GET') {
        const archive = await invokeRenderer('getArchive');
        return sendJson(res, 200, { ok: true, archive });
      }

      if (url.pathname === '/agent/run' && req.method === 'POST') {
        const body = await readJson(req);
        const action = String(body.action || '');
        if (action === 'import') {
          const folder = safePath(body.folder);
          const recursive = body.recursive !== false;
          if (!fs.existsSync(folder)) return sendJson(res, 400, { ok: false, error: 'Pasta XML não encontrada.' });
          const paths = await walkXml(folder, recursive, Number(body.limit || 10000));
          const files = await readXmlFiles(paths);
          const imported = await invokeRenderer('importXmlBatch', [files]);
          return sendJson(res, 200, { ok: true, found: paths.length, imported });
        }
        return sendJson(res, 400, { ok: false, error: `Ação não suportada: ${action}` });
      }

      return sendJson(res, 404, { ok: false, error: 'Endpoint não encontrado.' });
    } catch (error) {
      console.error('[fiscoai-agent]', error);
      return sendJson(res, 500, { ok: false, error: error?.message || String(error) });
    }
  }

  return {
    async start() {
      token = await ensureToken();
      const actualPort = Number(port || DEFAULT_PORT);
      server = http.createServer((req, res) => handle(req, res));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(actualPort, '127.0.0.1', resolve);
      });
      await fsp.mkdir(APP_DIR, { recursive: true });
      await fsp.writeFile(CONFIG_FILE, JSON.stringify({ port: actualPort, host: '127.0.0.1', tokenFile: TOKEN_FILE }, null, 2), { encoding: 'utf8' });
      console.log(`[fiscoai-agent] API local em http://127.0.0.1:${actualPort}`);
      console.log(`[fiscoai-agent] token em ${TOKEN_FILE}`);
      return { port: actualPort, tokenFile: TOKEN_FILE, configFile: CONFIG_FILE };
    },
    stop() {
      try { server?.close(); } catch {}
    },
  };
}

module.exports = { createLocalAgentApi, TOKEN_FILE };
