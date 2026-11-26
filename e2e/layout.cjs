const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { mainPage, hoverNotch, moveSystemCursor } = require('./window.cjs');

(async () => {
  const project = path.resolve(__dirname, '..');
  const root = path.resolve(project, '..', '..', 'work', 'hub-e2e-layout');
  fs.mkdirSync(root, { recursive: true });
  moveSystemCursor(20, 400);
  const app = await electron.launch({
    args: ['.'],
    cwd: project,
    env: { ...process.env, QUEUEGLOW_HOME: root },
  });
  try {
    await app.firstWindow();
    const win = await mainPage(app);
    await hoverNotch(app);
    await win.waitForSelector('.shell.motion-idle');
    const names = [
      'Home',
      'Codex',
      'Robo',
      'Music',
      'Focus',
      'Modes',
      'Tray',
      'Clips',
      'Note',
      'Agenda',
      'Mail',
    ];
    const results = [];
    for (const name of names) {
      await win.locator('.dock-plus').click();
      await win.locator('.all-grid button').filter({ hasText: name }).first().click();
      results.push(
        await win.evaluate(() => {
          const section = document.querySelector('.content > section');
          const scrollables = [section, ...section.querySelectorAll('*')]
            .filter((el) => {
              const overflow = getComputedStyle(el).overflowY;
              return ['auto', 'scroll'].includes(overflow) && el.scrollHeight > el.clientHeight + 2;
            })
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${el.className || ''}:${el.scrollHeight - el.clientHeight}`,
            );
          return {
            page: section.className,
            excess: section.scrollHeight - section.clientHeight,
            scrollables,
            background: getComputedStyle(document.querySelector('.shell'), '::before')
              .backgroundImage,
          };
        }),
      );
    }
    for (const name of ['All apps', 'Customize']) {
      await win.evaluate(() => {
        if (!document.querySelector('.menu'))
          document.querySelector('[aria-label="More options"]').click();
      });
      await win.getByRole('group', { name: 'App menu' }).getByRole('button', { name }).click();
      results.push(
        await win.evaluate(() => {
          const section = document.querySelector('.content > section');
          return {
            page: section.className,
            excess: section.scrollHeight - section.clientHeight,
            scrollables: [section, ...section.querySelectorAll('*')]
              .filter(
                (el) =>
                  ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
                  el.scrollHeight > el.clientHeight + 2,
              )
              .map((el) => `${el.className}:${el.scrollHeight - el.clientHeight}`),
            background: getComputedStyle(document.querySelector('.shell'), '::before')
              .backgroundImage,
          };
        }),
      );
    }
    await win.evaluate(() => {
      if (!document.querySelector('.menu'))
        document.querySelector('[aria-label="More options"]').click();
    });
    await win
      .getByRole('group', { name: 'App menu' })
      .getByRole('button', { name: 'All apps' })
      .click();
    await win.locator('.all-grid button').filter({ hasText: 'Agenda' }).click();
    await win.getByRole('button', { name: 'Month' }).click();
    results.push(
      await win.evaluate(() => {
        const section = document.querySelector('.content > section');
        return {
          page: 'agenda-month',
          excess: section.scrollHeight - section.clientHeight,
          scrollables: [],
        };
      }),
    );
    await win.evaluate(async () => {
      for (let i = 0; i < 5; i++)
        await window.hub.trayDrop(`file-${i}.txt`, new TextEncoder().encode(`file ${i}`));
    });
    await win.locator('.dock-plus').click();
    await win.locator('.all-grid button').filter({ hasText: 'Tray' }).click();
    if ((await win.locator('.item-list .list-item').count()) !== 2)
      throw new Error('Tray paging failed');
    await win.getByRole('button', { name: 'Next items' }).click();
    if ((await win.locator('.item-list .list-item').count()) !== 2)
      throw new Error('Tray next page failed');
    const trayOverflow = await win.evaluate(() => {
      const section = document.querySelector('.content > section');
      return section.scrollHeight - section.clientHeight;
    });
    if (trayOverflow > 2) throw new Error(`Loaded tray overflowed by ${trayOverflow}px`);
    if (results.some((result) => result.excess > 2 || result.scrollables.length))
      throw new Error(`Overflow: ${JSON.stringify(results)}`);
    const pageStates = results.slice(0, names.length);
    if (new Set(pageStates.map((result) => result.background)).size !== names.length)
      throw new Error('Each app destination must render its own page-specific visual state');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
