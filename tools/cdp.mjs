// Minimal zero-dependency Chrome DevTools Protocol driver.
// Node's native WebSocket plus a headless Chrome is enough to look at the served app.
// This exists so the implementer can see the browser instead of inferring it from source.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function firstExistingChrome() {
  const { access } = await import('node:fs/promises');
  for (const candidate of process.env.CHROME_PATH ? [process.env.CHROME_PATH, ...CHROME_CANDIDATES] : CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('no Chrome/Chromium binary found; set CHROME_PATH');
}

async function readDevToolsPort(userDataDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8');
      const port = Number.parseInt(raw.split('\n')[0], 10);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
    await delay(50);
  }
  throw new Error('Chrome did not report a DevTools port');
}

class Session {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.onmessage = (event) => this.#receive(event.data);
  }

  #receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result ?? {});
      return;
    }
    const handlers = this.#listeners.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(message.params ?? {});
  }

  on(method, handler) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set());
    this.#listeners.get(method).add(handler);
    return () => this.#listeners.get(method)?.delete(handler);
  }

  once(method, { timeoutMs = 30_000, filter = () => true } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params) => {
        if (!filter(params)) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify(payload));
    });
  }
}

// A single page under automation, with the console and failed requests it produced.
export class Page {
  constructor(session, sessionId) {
    this.session = session;
    this.sessionId = sessionId;
    this.consoleMessages = [];
    this.pageErrors = [];
    this.failedRequests = [];
  }

  #call(method, params) {
    return this.session.send(method, params, this.sessionId);
  }

  #scoped(method, handler) {
    return this.session.on(method, (params) => handler(params));
  }

  async prepare() {
    await this.#call('Page.enable');
    await this.#call('Runtime.enable');
    await this.#call('Log.enable');
    await this.#call('Network.enable');
    this.#scoped('Runtime.consoleAPICalled', (params) => {
      const text = (params.args ?? [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? arg.type)))
        .join(' ');
      this.consoleMessages.push({ level: params.type, text });
    });
    this.#scoped('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails ?? {};
      this.pageErrors.push(details.exception?.description ?? details.text ?? 'unknown page error');
    });
    this.#scoped('Log.entryAdded', (params) => {
      const entry = params.entry ?? {};
      this.consoleMessages.push({ level: entry.level, text: entry.text ?? '' });
    });
    this.#scoped('Network.loadingFailed', (params) => {
      if (params.type === 'Image' && params.blockedReason === undefined && params.canceled) return;
      this.failedRequests.push({ type: params.type, error: params.errorText });
    });
  }

  async setViewport(width, height, deviceScaleFactor = 1) {
    await this.#call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false
    });
  }

  async goto(url, { timeoutMs = 30_000 } = {}) {
    const loaded = this.session.once('Page.loadEventFired', { timeoutMs });
    await this.#call('Page.navigate', { url });
    await loaded;
  }

  async evaluate(expression, { timeoutMs = 30_000 } = {}) {
    const result = await this.#call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description ?? details.text ?? 'evaluate failed');
    }
    return result.result?.value;
  }

  // Poll an in-page predicate. Returns elapsed milliseconds, so callers can time
  // click-to-visible directly instead of guessing from logs.
  async waitFor(expression, { timeoutMs = 30_000, pollMs = 100, label = expression } = {}) {
    const started = Date.now();
    const deadline = started + timeoutMs;
    for (;;) {
      let value = false;
      try {
        value = await this.evaluate(`Boolean(${expression})`, { timeoutMs: 5_000 });
      } catch {}
      if (value) return Date.now() - started;
      if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
      await delay(pollMs);
    }
  }

  // Click the first element matching a selector whose text contains `text`.
  // Returns false when nothing matched, so callers can decide instead of silently passing.
  async clickText(selector, text) {
    return this.evaluate(`(() => {
      const wanted = ${JSON.stringify(text)}.toLowerCase();
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent.trim().toLowerCase().includes(wanted));
      if (!node || node.disabled) return false;
      node.click();
      return true;
    })()`);
  }

  // Set a <select> by visible option text and fire the events Svelte binds to.
  async selectByText(ariaLabel, text) {
    return this.evaluate(`(() => {
      const element = document.querySelector('select[aria-label=' + ${JSON.stringify(JSON.stringify(ariaLabel))} + ']');
      if (!element) return false;
      const wanted = ${JSON.stringify(text)}.toLowerCase();
      const option = [...element.options].find((candidate) => candidate.textContent.trim().toLowerCase().includes(wanted));
      if (!option) return false;
      element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async screenshot(path, { fullPage = false } = {}) {
    const { writeFile } = await import('node:fs/promises');
    const options = { format: 'png' };
    if (fullPage) {
      const { cssContentSize } = await this.#call('Page.getLayoutMetrics');
      if (cssContentSize) {
        options.captureBeyondViewport = true;
        options.clip = {
          x: 0,
          y: 0,
          width: Math.ceil(cssContentSize.width),
          height: Math.ceil(cssContentSize.height),
          scale: 1
        };
      }
    }
    const result = await this.#call('Page.captureScreenshot', options);
    await writeFile(path, Buffer.from(result.data, 'base64'));
    return path;
  }
}

export async function launch({ headless = true, width = 1600, height = 1000 } = {}) {
  const binary = await firstExistingChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), 'mullet-cdp-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`,
    'about:blank'
  ];
  if (headless) args.unshift('--headless=new', '--disable-gpu');

  const child = spawn(binary, args, { stdio: 'ignore', detached: false });
  const port = await readDevToolsPort(userDataDir, 20_000);

  const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = await versionResponse.json();

  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('CDP websocket failed to open'));
  });

  const session = new Session(socket);
  const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });

  const page = new Page(session, sessionId);
  await page.prepare();
  await page.setViewport(width, height);

  return {
    page,
    async close() {
      try {
        socket.close();
      } catch {}
      child.kill('SIGTERM');
      await delay(200);
      if (!child.killed) child.kill('SIGKILL');
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
