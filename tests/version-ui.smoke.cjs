const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const BASE_URL = process.env.CODE_ATLAS_URL || 'http://127.0.0.1:8765';
const FIXTURE_NAME = `version-ui-smoke-${Date.now()}`;
const FIXTURE_FILES = [
  { path: 'v000/src/acquisition.py', content: `def estimate_value(value):
    return value

def recommend(value):
    # @atlas-edge estimate_value: evidence for the acquisition recommendation
    return estimate_value(value)
` },
  { path: 'v000/tests/test_acquisition.py', content: 'def test_recommendation():\n    pass\n' },
  { path: 'v002/hybrid/optimizer.py', content: `def score_candidate(value):
    """Score one candidate in this historical version."""
    return value
` },
  { path: 'v002/tests/test_optimizer.py', content: 'def test_score_candidate():\n    pass\n' },
  { path: 'v003/hybrid/optimizer.py', content: `def score_candidate(value):
    return value

def optimize(value):
    # @atlas-edge score_candidate: optimizer uses the candidate score
    return score_candidate(value)
` },
];
const FIXTURE_PROJECTS = ['v000', 'v001', 'v002', 'v003', 'v004'].map(id => ({ id, name: id, root: id }));

async function selectVersion(page, version) {
  const select = page.locator('#project-select');
  const options = await select.locator('option').evaluateAll(items => items.map(option => ({
    text: option.textContent.trim(), value: option.value, disabled: option.disabled
  })));
  const option = options.find(item => item.text === version || item.text.includes(version) || item.value === version || item.value.includes(version));
  assert.ok(option, `project-select should contain ${version}: ${JSON.stringify(options)}`);
  if (option.disabled) return option;
  await select.selectOption({ value: option.value });
  await page.locator('#module-select').waitFor({ state: 'visible' });
  return option;
}

async function graphPaths(page) {
  return page.locator('.graph-card').evaluateAll(cards => cards.map(card => {
    const footer = card.querySelector('.node-footer [title]');
    return card.getAttribute('data-path') || card.getAttribute('title') || footer?.getAttribute('title') || card.textContent;
  }));
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  // Obtain the app's API token, then analyze a small fixture so the test has no
  // dependency on a repository or user-specific path on disk.
  const config = await page.request.get(`${BASE_URL}/api/config`);
  assert.equal(config.ok(), true);
  const configJson = await config.json();
  assert.equal(typeof configJson.token, 'string');

  await page.goto(BASE_URL);
  await page.locator('#project-select').waitFor({ state: 'visible', timeout: 20000 });
  const analysis = await page.request.post(`${BASE_URL}/api/analyze`, {
    headers: { 'X-Atlas-Token': configJson.token },
    data: { name: FIXTURE_NAME, files: FIXTURE_FILES, projects: FIXTURE_PROJECTS },
  });
  assert.equal(analysis.ok(), true, await analysis.text());
  const data = await analysis.json();
  await page.evaluate(async fixture => {
    const { loadData } = await import('/ui/repository.js');
    loadData(fixture);
  }, data);
  await page.locator('#repo-name').filter({ hasText: FIXTURE_NAME }).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#project-select').waitFor({ state: 'visible', timeout: 30000 });

  const projects = await page.locator('#project-select option').evaluateAll(items => items.map(option => ({
    text: option.textContent.trim(), disabled: option.disabled
  })));
  for (const version of ['v000', 'v001', 'v002', 'v003', 'v004']) {
    assert.ok(projects.some(item => item.text === version || item.text.includes(version)), `${version} should be listed`);
  }
  const emptyVersion = projects.find(item => item.text === 'v004' || item.text.includes('v004'));
  assert.ok(emptyVersion?.disabled, 'empty v004 should be displayed as disabled');

  await selectVersion(page, 'v003');
  const moduleOptions = await page.locator('#module-select option').evaluateAll(items => items.map(option => ({
    text: option.textContent.trim(), value: option.value
  })));
  const optimizer = moduleOptions.find(item => /hybrid[\\/]optimizer\.py/.test(`${item.text} ${item.value}`));
  assert.ok(optimizer, `v003 module list should expose hybrid/optimizer.py: ${JSON.stringify(moduleOptions)}`);
  await page.locator('#module-select').selectOption({ value: optimizer.value });
  await page.locator('.graph-card').first().waitFor({ state: 'visible', timeout: 30000 });
  assert.ok(await page.locator('.graph-card[data-kind="folder"],.graph-card[data-kind="file"],.graph-card[data-kind="repository"]').count());
  assert.ok(await page.locator('.graph-card[data-kind="file"]').count(), 'module selection should reveal the selected file without replacing the overview');

  const before = await graphPaths(page);
  assert.ok(before.length, 'module graph should contain nodes');
  await selectVersion(page, 'v002');
  const after = await graphPaths(page);
  assert.ok(after.length, 'changing project should render nodes');
  assert.equal(after.some(path => /(^|[\\/])v003[\\/]/.test(path)), false, 'project change must not leave v003 nodes mixed into v002');

  const includeTests = page.locator('#include-tests');
  await includeTests.waitFor({ state: 'attached' });
  const countWithoutTests = await page.locator('.graph-card').count();
  await includeTests.check();
  await page.waitForTimeout(150);
  const countWithTests = await page.locator('.graph-card').count();
  assert.ok(countWithTests >= countWithoutTests, 'include-tests should retain or add test nodes');
  await includeTests.uncheck();

  await selectVersion(page, 'v000');
  const acquisition = await page.locator('#module-select option').evaluateAll(items => items.map(option => ({text:option.textContent.trim(),value:option.value,disabled:option.disabled})).find(item => /acquisition\.py/.test(`${item.text} ${item.value}`) && !item.disabled));
  assert.ok(acquisition, 'v000 acquisition.py should be available for focused relation testing');
  await page.locator('#module-select').selectOption({value:acquisition.value});
  await page.locator('.graph-card[data-kind="file"] .node-open').click();
  await page.locator('#fit-button').click();
  const comments = page.locator('#show-comments');
  await comments.waitFor({ state: 'attached' });
  await comments.check();
  const edgeHits = page.locator('.edge-hit');
  const commentIndex = await edgeHits.evaluateAll(edges => edges.findIndex(edge => edge.querySelector('title')?.textContent?.trim()));
  assert.ok(commentIndex >= 0, 'graph should contain an edge with comment evidence');
  const sourceId=await page.locator('.graph-edge').nth(commentIndex).getAttribute('data-source');
  await page.locator(`.graph-card[data-id="${sourceId}"]`).click();
  const edgeLabels = page.locator('.edge-label,[data-edge-label]');
  await page.waitForFunction(() => [...document.querySelectorAll('.edge-floating-label')].some(label => getComputedStyle(label).visibility === 'visible' && Number(getComputedStyle(label).opacity) > 0));
  assert.ok(await edgeLabels.evaluateAll(labels => labels.some(label => {
    const style = getComputedStyle(label);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  })), 'comment labels should be visible when show-comments is on');
  await page.locator('.edge-label-click').first().click({force:true});
  assert.ok(await page.locator('.edge-evidence').count(), 'selected comment edge should show evidence');
  assert.match(await page.locator('body').textContent(), /出典|evidence|Evidence/);
  await comments.uncheck();
  assert.ok(await edgeLabels.evaluateAll(labels => labels.every(label => {
    const style = getComputedStyle(label);
    return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0;
  })), 'comment labels should be hidden when show-comments is off');

  const background = await page.evaluate(() => {
    let target = document.querySelector('.graph-viewport') || document.body;
    while (target) {
      const value = getComputedStyle(target).backgroundColor;
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()));
        const alpha = parts.length === 4 ? parts[3] : 1;
        if (alpha > 0) return { value, rgb: parts.slice(0, 3) };
      }
      target = target.parentElement;
    }
    return { value: 'transparent', rgb: [] };
  });
  assert.ok(background.rgb.length >= 3 && background.rgb.every(Number.isFinite), `opaque background expected, got ${background.value}`);
  assert.ok(background.rgb.reduce((sum, channel) => sum + channel, 0) / 3 > 210, `light background expected, got ${background.value}`);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/version-projects.png', fullPage: true });

  assert.deepEqual(errors, []);
  console.log('Version UI smoke passed: API fixture, project/module selection, empty-version handling, graph isolation, test/comment toggles, evidence, light theme.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
