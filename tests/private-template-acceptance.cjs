// Optional local acceptance. The source is copied into an isolated profile and never appears in logs.
const assert = require('node:assert/strict')
const { expect } = require('@playwright/test')
const { withProfile, readyDocument, openPicker, select, ids } = require('./template-harness.cjs')

async function run({ page }) {
  const [original] = await page.evaluate(() => window.studio.list())
  await page.locator('.doc-title').first().click()
  await expect(readyDocument(page).locator('.paper-page')).toHaveCount(2)
  const picker = await openPicker(page)
  let min = Infinity,
    max = 0
  for (const id of ids) {
    await select(picker, id)
    const candidate = picker.locator('[data-template-pane="candidate"]')
    await expect.poll(async () => Number(await candidate.getAttribute('data-page-count'))).toBeGreaterThan(0)
    const count = Number(await candidate.getAttribute('data-page-count'))
    const pageText = await candidate.locator('.paper-document').textContent()
    assert.ok(pageText.includes(original.target), 'Private target missing in ' + id)
    min = Math.min(min, count)
    max = Math.max(max, count)
  }
  await picker.getByRole('button', { name: '对比当前样式' }).click()
  await picker.getByRole('button', { name: '应用此模板' }).click()
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'F5')
  await page.keyboard.press('Meta+z')
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', '00')
  await expect(page.locator('.save-status')).toContainText('已保存在本机')
  const [restored] = await page.evaluate(() => window.studio.list())
  assert.deepEqual(restored.sections, original.sections)
  assert.deepEqual(restored.style, original.style)
  assert.deepEqual(restored.photo, original.photo)
  console.log(
    'PASS private local baseline: 31 real layouts, page counts ' +
      min +
      '–' +
      max +
      ', compare, apply, undo and saved source equality',
  )
}
const source = process.env.RESUME_TEST_SEED
if (!source) throw Error('Set RESUME_TEST_SEED to an editable local baseline.')
withProfile('studio-private-layout', run, source).catch((e) => {
  console.error(e)
  process.exitCode = 1
})
