const { app, BrowserWindow, dialog, shell, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { createLocalAgentApi } = require('./agent/local-api.cjs');

// Mantém a aplicação consciente de telas HiDPI/escala do Windows sem forçar
// uma escala física fixa. O Chromium/Electron passa a respeitar o DPI do monitor.
app.commandLine.appendSwitch('high-dpi-support', '1');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;
let port = Number(process.env.FISCOAI_PORT || 4173);
let agentApi = null;
let agentPort = Number(process.env.FISCOAI_AGENT_PORT || 4790);

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function getServerEntry() {
  // No app empacotado, o electron-builder coloca .output dentro do app.asar.
  // app.getAppPath() aponta para esse conteúdo tanto com asar quanto sem asar.
  return path.join(app.getAppPath(), '.output', 'server', 'index.mjs');
}

function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const retry = (lastError) => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Servidor local não respondeu em ${timeoutMs / 1000}s.${lastError ? `\nÚltimo erro: ${lastError.message}` : ''}`));
        return;
      }
      setTimeout(check, 400);
    };

    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry(new Error(`HTTP ${res.statusCode ?? 'desconhecido'}`));
      });
      req.on('error', retry);
      req.setTimeout(2500, () => {
        req.destroy();
        retry(new Error('timeout de conexão'));
      });
    };

    check();
  });
}

function canListen(candidatePort) {
  return new Promise((resolve) => {
    const tester = require('net').createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(candidatePort, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let candidate = startPort; candidate < startPort + 20; candidate += 1) {
    if (await canListen(candidate)) return candidate;
  }
  throw new Error('Não foi encontrado um porta TCP livre para iniciar o FiscoAI.');
}

function startLocalServer() {
  const entry = getServerEntry();
  if (!fileExists(entry)) {
    throw new Error(`Arquivo do servidor não encontrado:\n${entry}\n\nExecute o build antes de iniciar o aplicativo.`);
  }

  // Durante o desenvolvimento usamos o Node.js instalado na máquina.
  // No aplicativo empacotado usamos o próprio Electron em modo Node.
  const executable = isDev ? (process.env.npm_node_execpath || 'node') : process.execPath;
  const env = {
    ...process.env,
    // Electron empacotado precisa ser iniciado em modo Node para executar o servidor Nitro.
    ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
    NODE_ENV: 'production',
    NITRO_PRESET: 'node',
    NITRO_PORT: String(port),
    PORT: String(port),
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
  };

  serverProcess = spawn(executable, [entry], {
    env,
    cwd: process.resourcesPath,
    stdio: 'pipe',
    windowsHide: true,
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  serverProcess.stdout?.on('data', (data) => {
    stdout += data.toString();
    if (stdout.length > 8000) stdout = stdout.slice(-8000);
    console.log(`[fiscoai-server] ${data}`);
  });
  serverProcess.stderr?.on('data', (data) => {
    stderr += data.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
    console.error(`[fiscoai-server] ${data}`);
  });

  serverProcess.once('error', (error) => {
    console.error('[fiscoai-server] spawn error', error);
  });
  serverProcess.once('exit', (code, signal) => {
    console.log(`[fiscoai-server] saiu. code=${code} signal=${signal}`);
    if (code !== 0 && !app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'FiscoAI - servidor local',
        `O servidor local foi encerrado antes da aplicação abrir.\n\nCódigo: ${code ?? 'n/a'}\nSinal: ${signal ?? 'n/a'}\n\n${stderr || stdout || 'Nenhuma mensagem adicional foi retornada.'}`,
      );
    }
  });
}

async function startAgentApi() {
  agentPort = await findAvailablePort(agentPort);
  agentApi = createLocalAgentApi({ getMainWindow: () => mainWindow, getPort: () => agentPort, port: agentPort });
  try {
    await agentApi.start();
  } catch (error) {
    console.error('[fiscoai-agent] não foi possível iniciar a API local:', error);
  }
}

async function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workAreaSize;

  // Abre em um tamanho proporcional à área útil do monitor.
  // Em notebooks/monitores menores evita que a janela nasça maior que a tela.
  const initialWidth = Math.min(1440, Math.max(980, workArea.width - 80));
  const initialHeight = Math.min(900, Math.max(620, workArea.height - 80));

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    // Garante que um zoom acidental (Ctrl +/-) não altere a proporção da interface.
    try {
      mainWindow.webContents.setZoomFactor(1);
      mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    } catch {}
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try { mainWindow.webContents.setZoomFactor(1); } catch {}
  });

  mainWindow.on('resized', () => {
    // Pequenos monitores: garante que a janela permaneça sempre dentro da área útil.
    const bounds = mainWindow.getBounds();
    const wa = screen.getDisplayMatching(bounds).workArea;
    const maxW = wa.width;
    const maxH = wa.height;
    if (bounds.width > maxW || bounds.height > maxH) {
      mainWindow.setBounds({
        ...bounds,
        width: Math.min(bounds.width, maxW),
        height: Math.min(bounds.height, maxH),
      });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    port = await findAvailablePort(port);
    startLocalServer();
    const localUrl = `http://127.0.0.1:${port}`;
    await waitForServer(localUrl);
    await mainWindow.loadURL(localUrl);
    await startAgentApi();
  } catch (error) {
    dialog.showErrorBox(
      'FiscoAI',
      `Não foi possível iniciar a aplicação local.\n\n${error?.message || error}`,
    );
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  app.isQuitting = true;
  try { agentApi?.stop(); } catch {}
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
