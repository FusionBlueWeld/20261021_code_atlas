const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const BASE_URL = process.env.CODE_ATLAS_URL || 'http://127.0.0.1:8765';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE_URL);
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.locator('.graph-card[data-id="root"]').waitFor({ state: 'visible' });

    const layoutControl = page.locator('#layout-control');
    const verticalGap = page.locator('#vertical-gap');
    const horizontalGap = page.locator('#horizontal-gap');
    assert.equal(await layoutControl.locator('.spacing-row').count(), 2, 'layout controls should be arranged in two rows');
    assert.equal(await verticalGap.getAttribute('min'), '152');
    assert.equal(await verticalGap.getAttribute('max'), '640');
    assert.equal(await verticalGap.inputValue(), '168');
    assert.equal(await horizontalGap.getAttribute('min'), '292');
    assert.equal(await horizontalGap.getAttribute('max'), '900');
    assert.equal(await horizontalGap.inputValue(), '338');
    assert.deepEqual(await layoutControl.locator('.spacing-row label, .spacing-row output').evaluateAll(elements => elements.map(element => getComputedStyle(element).userSelect)), ['none', 'none', 'none', 'none']);

    const labelPoint = await layoutControl.locator('.spacing-row:first-child label').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const transformBeforeLabelDrag = await page.locator('#graph-world').evaluate(element => element.style.transform);
    await page.mouse.move(labelPoint.x, labelPoint.y);
    await page.mouse.down();
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), true);
    await page.mouse.move(labelPoint.x + 54, labelPoint.y + 22, { steps: 5 });
    await page.mouse.up();
    const labelDragResult = await page.evaluate(() => ({
      transform: document.querySelector('#graph-world').style.transform,
      selection: window.getSelection()?.toString() || '',
    }));
    assert.notEqual(labelDragResult.transform, transformBeforeLabelDrag, 'dragging a layout label should pan the graph');
    assert.equal(labelDragResult.selection, '', 'dragging a layout label must not select text');
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), false);

    const outputPoint = await page.locator('#vertical-gap-value').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const transformBeforeOutputDrag = await page.locator('#graph-world').evaluate(element => element.style.transform);
    await page.mouse.move(outputPoint.x, outputPoint.y);
    await page.mouse.down();
    await page.mouse.move(outputPoint.x + 48, outputPoint.y + 16, { steps: 5 });
    await page.mouse.up();
    const outputDragResult = await page.evaluate(() => ({
      transform: document.querySelector('#graph-world').style.transform,
      selection: window.getSelection()?.toString() || '',
    }));
    assert.notEqual(outputDragResult.transform, transformBeforeOutputDrag, 'dragging a spacing value should pan the graph');
    assert.equal(outputDragResult.selection, '', 'dragging a spacing value must not select text');

    const backgroundPoint = await layoutControl.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + 2, y = rect.top + 2;
      const target = document.elementFromPoint(x, y);
      return { x, y, targetInsideControl: element.contains(target), targetTag: target?.tagName };
    });
    assert.equal(backgroundPoint.targetInsideControl, true);
    assert.notEqual(backgroundPoint.targetTag, 'INPUT');
    const transformBeforeBackgroundDrag = await page.locator('#graph-world').evaluate(element => element.style.transform);
    await page.mouse.move(backgroundPoint.x, backgroundPoint.y);
    await page.mouse.down();
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), true);
    await page.mouse.move(backgroundPoint.x + 42, backgroundPoint.y + 18, { steps: 5 });
    await page.mouse.up();
    const transformAfterBackgroundDrag = await page.locator('#graph-world').evaluate(element => element.style.transform);
    assert.notEqual(transformAfterBackgroundDrag, transformBeforeBackgroundDrag, 'dragging the layout panel background should pan the graph');

    const verticalBox = await verticalGap.boundingBox();
    const verticalBeforeTrack = await verticalGap.inputValue();
    await page.mouse.move(verticalBox.x + verticalBox.width * 0.78, verticalBox.y + verticalBox.height / 2);
    await page.mouse.down();
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), false, 'range input must not start graph panning');
    assert.notEqual(await verticalGap.inputValue(), verticalBeforeTrack, 'mouse interaction with the vertical range track should change its value');
    await page.mouse.move(verticalBox.x + verticalBox.width * 0.82, verticalBox.y + verticalBox.height / 2, { steps: 3 });
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), false);
    await page.mouse.up();

    const horizontalBox = await horizontalGap.boundingBox();
    const horizontalBeforeTrack = await horizontalGap.inputValue();
    await page.mouse.move(horizontalBox.x + horizontalBox.width * 0.78, horizontalBox.y + horizontalBox.height / 2);
    await page.mouse.down();
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), false, 'range input must not start graph panning');
    assert.notEqual(await horizontalGap.inputValue(), horizontalBeforeTrack, 'mouse interaction with the horizontal range track should change its value');
    await page.mouse.move(horizontalBox.x + horizontalBox.width * 0.82, horizontalBox.y + horizontalBox.height / 2, { steps: 3 });
    assert.equal(await page.locator('#graph-viewport').evaluate(element => element.classList.contains('dragging')), false);
    await page.mouse.up();

    await verticalGap.fill('360');
    await horizontalGap.fill('540');
    await page.waitForFunction(() => {
      const columns = [...new Set([...document.querySelectorAll('.graph-card')].map(card => parseFloat(card.style.left)).filter(Number.isFinite))].sort((a, b) => a - b);
      return columns.some((left, index) => index > 0 && left - columns[index - 1] === 540);
    });
    const columnPitch = await page.evaluate(() => {
      const columns = [...new Set([...document.querySelectorAll('.graph-card')].map(card => parseFloat(card.style.left)).filter(Number.isFinite))].sort((a, b) => a - b);
      return Math.min(...columns.slice(1).map((left, index) => left - columns[index]));
    });
    assert.equal(columnPitch, 540, 'horizontal gap should set the distance between rendered graph columns');
    assert.equal(await page.locator('#vertical-gap-value').textContent(), '360px');
    assert.equal(await page.locator('#horizontal-gap-value').textContent(), '540px');

    await page.reload();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.locator('.graph-card[data-id="root"]').waitFor({ state: 'visible' });
    assert.equal(await verticalGap.inputValue(), '360', 'vertical gap should be restored after reload');
    assert.equal(await horizontalGap.inputValue(), '540', 'horizontal gap should be restored after reload');
    const restoredColumnPitch = await page.evaluate(() => {
      const columns = [...new Set([...document.querySelectorAll('.graph-card')].map(card => parseFloat(card.style.left)).filter(Number.isFinite))].sort((a, b) => a - b);
      return Math.min(...columns.slice(1).map((left, index) => left - columns[index]));
    });
    assert.equal(restoredColumnPitch, 540, 'restored horizontal gap should still control rendered graph columns');

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowLayout = await page.evaluate(() => {
      const rect = document.querySelector('#layout-control').getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    assert.ok(narrowLayout.left >= 0 && narrowLayout.right <= narrowLayout.viewportWidth, `layout panel should fit the narrow viewport: ${JSON.stringify(narrowLayout)}`);
    assert.ok(narrowLayout.documentWidth <= narrowLayout.viewportWidth, `layout panel must not cause horizontal overflow: ${JSON.stringify(narrowLayout)}`);
    assert.deepEqual(errors, []);
    console.log('Layout controls smoke passed: panel panning, text selection, range interaction, column pitch, persisted gaps, and mobile fit.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
