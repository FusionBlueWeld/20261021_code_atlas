// End-to-end checks for card geometry and controls that must remain clickable.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const BASE_URL = process.env.CODE_ATLAS_URL || 'http://127.0.0.1:8765';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE_URL);
    await page.locator('.graph-card').first().waitFor();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.evaluate(async () => {
      // A valid JSON value with the wrong shape must not break startup.
      localStorage.setItem('atlas.scope:UI regression fixture', 'null');
      const config = await (await fetch('/api/config')).json();
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': config.token },
        body: JSON.stringify({ name: 'UI regression fixture', files: [
          { path: 'app.py', content: 'def helper():\n    """A comment for the helper."""\n    pass\ndef recurse(n):\n    return recurse(n-1) if n else helper()\n' },
          { path: 'constants.py', content: 'VALUE = 1\n' },
          { path: 'pkg/__init__.py', content: '' },
          { path: 'broken.py', content: 'def broken(:\n' },
        ] }),
      });
      if (!response.ok) throw new Error('Fixture analysis failed');
      const { loadData } = await import('/ui/repository.js');
      loadData(await response.json());
    });
    const root = page.locator('.graph-card[data-id="root"]');
    const rootButton = root.locator('.node-open');
    const colors = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.graph-card.repository')).backgroundColor,
      getComputedStyle(document.querySelector('.graph-card.file')).backgroundColor,
      getComputedStyle(document.querySelector('.graph-card.folder')).backgroundColor,
    ]);
    assert.equal(new Set(colors).size, 3, 'Repository, file, and folder need distinct backgrounds');
    assert.ok((await page.locator('#toggle-sidebar').boundingBox()).x < 20);
    assert.ok((await page.locator('#toggle-inspector').boundingBox()).x > 1380);
    assert.equal(await page.locator('.panel-toggle svg').count(), 2);

    const geometry = await page.locator('.graph-card').evaluateAll(cards => cards.map(card => {
      const cardRect = card.getBoundingClientRect();
      const footer = card.querySelector('.node-footer').getBoundingClientRect();
      const button = card.querySelector('.node-open')?.getBoundingClientRect();
      return { footerFits: footer.bottom < cardRect.bottom, buttonFits: !button || button.bottom < cardRect.bottom, height: card.offsetHeight };
    }));
    assert.ok(geometry.every(g => g.footerFits && g.buttonFits && g.height === 128), JSON.stringify(geometry));

    async function dragPanel(side, delta) {
      const handle = page.locator(`#resize-${side}`);
      const box = await handle.boundingBox();
      const before = await page.locator(`#${side}`).evaluate(el => el.getBoundingClientRect().width);
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + 100, { steps: 8 });
      await page.mouse.up();
      const after = await page.locator(`#${side}`).evaluate(el => el.getBoundingClientRect().width);
      assert.ok(after > before + 60, `${side}: ${before} -> ${after}`);
      return after;
    }
    const leftWidth = await dragPanel('sidebar', 90);
    const rightWidth = await dragPanel('inspector', -90);

    // Resize during a pressed button: the target must survive until click.
    const target = await rootButton.elementHandle();
    const box = await rootButton.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.setViewportSize({ width: 1441, height: 1000 });
    await page.waitForTimeout(180);
    assert.equal(await target.evaluate(el => el.isConnected), true);
    await page.mouse.up();
    assert.equal(await root.getAttribute('aria-expanded'), 'false');
    for (let i = 0; i < 10; i++) {
      const before = await root.getAttribute('aria-expanded');
      await rootButton.click();
      assert.notEqual(await root.getAttribute('aria-expanded'), before, `Toggle ${i} was lost`);
    }
    if (await root.getAttribute('aria-expanded') === 'false') await rootButton.click();
    await page.locator('#fit-button').click();
    const file = page.locator('.graph-card[data-id="file:app.py"]');
    await file.locator('.node-open').click();
    await page.locator('#search').fill('recurse');
    await page.locator('.tree-row').filter({ hasText: 'recurse' }).click();
    assert.ok(await page.locator('.graph-edge[data-kind="calls"]').count());
    const label = page.locator('.edge-floating-label').first();
    assert.ok(await label.count());
    await label.evaluate(el => el.classList.add('visible'));
    const hitTargets = await page.locator('.node-open').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      const view = document.querySelector('#graph-viewport').getBoundingClientRect();
      if (rect.left < view.left || rect.right > view.right || rect.top < view.top || rect.bottom > view.bottom) return true;
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return button.contains(hit);
    }));
    assert.ok(hitTargets.every(Boolean), 'A graph overlay covered an expand/collapse button');

    await page.locator('#vertical-gap').fill('480');
    assert.equal(await page.locator('#vertical-gap-value').textContent(), '480px');
    await page.locator('#search').fill('constants.py');
    await page.locator('.tree-row').filter({ hasText: 'constants.py' }).click();
    assert.ok((await page.locator('.source-code').textContent()).includes('VALUE = 1'));
    fs.mkdirSync('artifacts/ui-20261020', { recursive: true });
    await page.locator('#search').fill('');
    await page.locator('#vertical-gap').fill('168');
    await page.locator('#fit-button').click();
    await page.screenshot({ path: 'artifacts/ui-20261020/desktop.png', fullPage: true });
    await root.screenshot({ path: 'artifacts/ui-20261020/card.png' });
    await page.locator('#vertical-gap').fill('480');
    await page.reload();
    await page.locator('.graph-card').first().waitFor();
    assert.ok(Math.abs((await page.locator('#sidebar').boundingBox()).width - leftWidth) < 2);
    assert.ok(Math.abs((await page.locator('#inspector').boundingBox()).width - rightWidth) < 2);
    assert.equal(await page.locator('#vertical-gap').inputValue(), '480');
    await page.locator('#toggle-sidebar').click();
    await page.locator('#toggle-sidebar').click();
    assert.ok(Math.abs((await page.locator('#sidebar').boundingBox()).width - leftWidth) < 2);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'artifacts/ui-20261020/mobile.png', fullPage: true });
    await page.evaluate(() => localStorage.setItem('atlas.lastPath', 'Z:/code-atlas-fixture-does-not-exist'));
    await page.reload();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.locator('#open-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#open-error').textContent(), /見つかりません/);
    assert.deepEqual(errors, []);
    console.log('UI regressions passed: colors, footer bounds, panel icons/drag/persistence, resize during press, repeated toggles, labels, 480px spacing, source, mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
