const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moveSystemCursor } = require('./window.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queueglow-settings-e2e-'));
  const codexConfig = path.join(root, 'codex-hooks.json');
  let app;
  try {
    moveSystemCursor(20, 400);
    app = await electron.launch({
      args: ['.'],
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        QUEUEGLOW_HOME: root,
        QUEUEGLOW_CODEX_HOOKS: codexConfig,
        QUEUEGLOW_CLAUDE_SETTINGS: path.join(root, 'claude-settings.json'),
      },
    });
    const island = await app.firstWindow();
    moveSystemCursor(20, 400);
    await island.evaluate(() => window.hub.fold());
    const settingsPromise = app.waitForEvent('window', { timeout: 12000 });
    await island.evaluate(() => window.hub.openSettings('connections'));
    const settings = await settingsPromise;
    settings.setDefaultTimeout(10000);
    await settings.getByRole('heading', { name: 'Connections', exact: true }).waitFor();
    const proportions = await settings.evaluate(() => {
      const shell = document.querySelector('.settings-shell');
      const main = document.querySelector('main');
      const content = document.querySelector('.content');
      const header = content.querySelector('header');
      return {
        sidebar: parseFloat(getComputedStyle(shell).gridTemplateColumns),
        main: main.getBoundingClientRect().width,
        content: content.getBoundingClientRect().width,
        header: header.getBoundingClientRect().width,
      };
    });
    assert.equal(proportions.sidebar, 232);
    assert.ok(proportions.content >= proportions.main - 2, JSON.stringify(proportions));
    assert.ok(proportions.header >= proportions.main - 2, JSON.stringify(proportions));
    await settings.screenshot({
      path: path.resolve(__dirname, '..', 'screenshot-settings-connections.png'),
    });
    assert.equal(await island.evaluate(async () => (await window.hub.state()).folded), true);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (win) => win.getTitle() === 'Queueglow Settings' && win.isResizable(),
        ),
      ),
      true,
    );
    assert.equal(await settings.evaluate(() => !!window.queueglowSettings && !window.hub), true);

    const codex = settings
      .locator('.setting-row')
      .filter({ has: settings.getByText('Codex', { exact: true }) });
    await codex.getByRole('button', { name: 'Connect', exact: true }).click();
    await codex.getByText('Hooks installed').waitFor();
    assert.ok(JSON.parse(fs.readFileSync(codexConfig, 'utf8')).hooks.PostToolUse.length);
    await codex.getByRole('button', { name: 'Disconnect' }).click();
    await codex.getByRole('button', { name: 'Connect', exact: true }).waitFor();

    await settings.getByRole('navigation').getByRole('button', { name: 'AI & Chat' }).click();
    await settings.getByLabel('Robo answers with').selectOption('codex');
    await settings.waitForFunction(
      async () => (await window.queueglowSettings.state()).settings.roboProvider === 'codex',
    );

    await island.evaluate(() => window.hub.openSettings('general'));
    const hotkey = settings.getByLabel('Global island shortcut');
    await hotkey.selectOption('Control+Shift+Q');
    await settings.waitForFunction(
      async () =>
        (await window.queueglowSettings.state()).settings.globalHotkey === 'Control+Shift+Q',
    );

    await settings
      .getByRole('navigation')
      .getByRole('button', { name: 'Island', exact: true })
      .click();
    await settings.getByRole('heading', { name: 'Island', exact: true }).waitFor();
    await settings.screenshot({
      path: path.resolve(__dirname, '..', 'screenshot-settings-island.png'),
    });
    const size = settings.getByLabel('Size', { exact: true });
    await size.selectOption('compact');
    await settings.waitForFunction(
      async () => (await window.queueglowSettings.state()).settings.islandSize === 'compact',
    );
    const expansion = settings.getByLabel('Open the island');
    await expansion.selectOption('click');
    await settings.waitForFunction(
      async () => (await window.queueglowSettings.state()).settings.islandExpansion === 'click',
    );
    await settings.getByLabel('Synced lyrics').check();
    await settings.waitForFunction(
      async () => (await window.queueglowSettings.state()).settings.lyricsEnabled,
    );

    await island.evaluate(() => window.hub.openSettings('apps'));
    await settings.getByRole('heading', { name: 'Apps', exact: true }).waitFor();
    assert.equal(app.windows().length, 2);
    const slot = settings.locator('.shortcut-form').first();
    await slot.getByLabel('Shortcut 1').fill('Docs');
    await slot.getByLabel('Web address').fill('https://example.com/docs');
    await slot.getByRole('button', { name: 'Save', exact: true }).click();
    await slot.getByRole('button', { name: 'Remove', exact: true }).waitFor();
    const [shortcut] = await island.evaluate(
      async () => (await window.hub.state()).settings.customShortcuts,
    );
    assert.deepEqual(shortcut, { label: 'Docs', url: 'https://example.com/docs' });
    const programPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe');
    await settings.evaluate(
      (executable) =>
        window.queueglowSettings.shortcut(1, {
          label: 'Notepad',
          type: 'program',
          path: executable,
        }),
      programPath,
    );
    const shortcuts = await island.evaluate(
      async () => (await window.hub.state()).settings.customShortcuts,
    );
    assert.deepEqual(shortcuts[1], { label: 'Notepad', type: 'program', path: programPath });
    assert.equal(await island.evaluate(async () => (await window.hub.state()).folded), true);

    await settings.close();
    const reopenedPromise = app.waitForEvent('window', { timeout: 12000 });
    await island.evaluate(() => window.hub.openSettings('island'));
    const reopened = await reopenedPromise;
    await reopened.getByRole('heading', { name: 'Island', exact: true }).waitFor();
    assert.equal(await reopened.getByLabel('Size', { exact: true }).inputValue(), 'compact');
    assert.equal(await reopened.getByLabel('Synced lyrics').isChecked(), true);
    console.log('Settings E2E passed: standalone window, hooks, island preferences, and shortcuts');
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
