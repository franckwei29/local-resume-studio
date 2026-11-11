const { expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { DatabaseSync } = require('node:sqlite')
const { ids, withProfile, readyDocument, openPicker, select } = require('./template-harness.cjs')
const button = (root, name) => root.getByRole('button', { name, exact: true })
const list = (page) => page.evaluate(() => window.studio.list())
async function editFirst(page) {
  await page.locator('.doc-title').first().click()
  await expect(readyDocument(page)).toBeAttached()
}
async function previewAndApply(page, id) {
  const picker = await openPicker(page)
  await select(picker, id)
  await button(picker, '应用此模板').click()
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', id)
}

async function interaction({ app, page, dir, profile }) {
  await editFirst(page)
  const [baseline] = await list(page)
  const original = baseline.target
  await page.locator('[data-node-kind="target"] .re-toggle').click()
  const target = page.getByRole('textbox', { name: '目标岗位', exact: true })
  await target.fill('交互验收初稿')
  let picker = await openPicker(page)
  const cards = picker.locator('[data-template-option]')
  assert.deepEqual(
    (await cards.evaluateAll((xs) => xs.map((x) => x.dataset.templateOption))).sort(),
    ids.slice().sort(),
  )
  const columns = picker.getByLabel('栏型', { exact: true })
  for (const [label, count] of [
    ['单栏', 20],
    ['左侧栏', 6],
    ['右侧栏', 5],
  ]) {
    await columns.selectOption({ label })
    assert.equal(await cards.count(), count)
  }
  await columns.selectOption({ index: 0 })
  await picker.getByLabel('照片', { exact: true }).selectOption({ index: 1 })
  assert.equal(await cards.count(), 5)
  await picker.getByLabel('搜索模板').fill('zzzz-不存在')
  assert.equal(await cards.count(), 0)
  await button(picker, '清空筛选').click()
  await picker.getByLabel('搜索模板').fill('左侧相框')
  assert.equal(await cards.count(), 1)
  await cards.first().focus()
  await page.keyboard.press('Enter')
  await expect(picker.locator('[data-template-pane="candidate"]')).toContainText('交互验收初稿')
  await picker.getByLabel('搜索模板').fill('')
  await picker.evaluate((el) => {
    for (const id of ['B2', 'E4', 'C3']) el.querySelector('[data-template-option="' + id + '"]').click()
  })
  await expect(picker.locator('[data-template-pane="candidate"] .paper-document')).toHaveAttribute(
    'data-template-id',
    'C3',
  )
  await button(picker, '对比当前样式').click()
  await expect(picker.locator('[data-template-pane="current"]')).toContainText('交互验收初稿')
  await expect(picker.locator('[data-template-pane="candidate"]')).toContainText('交互验收初稿')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.template-trigger')).toBeFocused()
  await expect(page.locator('.save-status')).toContainText('已保存在本机')
  let [stored] = await list(page)
  assert.equal(stored.templateId, '00')
  assert.equal(stored.revision, baseline.revision + 1)
  assert.deepEqual(stored.templateLayouts, {})
  console.log('PASS T01/T02/T03 all 31 choices, offline compound filters, keyboard and candidate isolation')

  await previewAndApply(page, 'A1')
  await expect(page.locator('[data-editor-lane="side"]')).toHaveCount(0)
  await target.fill('确认后继续编辑')
  await page.keyboard.press('Meta+z')
  await expect(target).toHaveValue('交互验收初稿')
  await page.keyboard.press('Meta+z')
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', '00')
  await page.keyboard.press('Meta+Shift+z')
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'A1')
  await page.keyboard.press('Meta+Shift+z')
  await expect(target).toHaveValue('确认后继续编辑')
  const skill = baseline.sections.find((s) => s.kind === 'skills')
  await page
    .locator('[data-editor-id="' + skill.id + '"] > .re-rowhead [data-drag-id]')
    .dragTo(
      page.locator(
        '[data-editor-id="' + baseline.sections.find((s) => s.kind === 'education').id + '"] > .re-rowhead',
      ),
      { targetPosition: { x: 12, y: 2 } },
    )
  await previewAndApply(page, 'C1')
  await expect(page.locator('[data-editor-lane="side"] [data-editor-id="' + skill.id + '"]')).toBeAttached()
  await previewAndApply(page, 'A1')
  const order = await page
    .locator('[data-editor-lane="main"] > .re-section')
    .evaluateAll((nodes) => nodes.map((x) => x.dataset.editorId))
  assert.ok(order.indexOf(skill.id) < order.indexOf(baseline.sections.find((s) => s.kind === 'education').id))
  console.log('PASS T05/T06 editor undo/redo, single lane, actual drag and remembered order')

  // Force a real SQLite transaction to fail after apply, then repair and save a newer edit.
  await expect(page.locator('.save-status')).toContainText('已保存在本机')
  const db = new DatabaseSync(path.join(profile, 'resumes.sqlite'))
  try {
    db.exec(
      "CREATE TRIGGER test_disk_failure BEFORE UPDATE ON docs BEGIN SELECT RAISE(ABORT,'disk failure in isolated test profile'); END",
    )
    await previewAndApply(page, 'B4')
    await expect(page.locator('.error-banner')).toContainText('保存失败')
    assert.equal((await list(page))[0].templateId, 'A1')
    await target.fill('最新草稿')
    db.exec('DROP TRIGGER test_disk_failure')
    await button(page.locator('.error-banner'), '重试').click()
    await expect(page.locator('.save-status')).toContainText('已保存在本机')
    ;[stored] = await list(page)
    assert.equal(stored.target, '最新草稿')
    assert.equal(stored.templateId, 'B4')
    assert.deepEqual(stored.photo, baseline.photo)
  } finally {
    db.close()
  }
  const file = path.join(dir, 'confirmed.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await previewAndApply(page, 'D4')
  await button(page, '导出 PDF').click()
  await expect(page.locator('.toast').filter({ hasText: '已导出 confirmed.pdf' })).toBeVisible()
  await page.locator('.work-header .back').click()
  await expect(page.locator('.doc-card .doc-sub')).toContainText('日期页边')
  console.log(
    'PASS T09/T12 hidden photo restored, transactional failure and retry with latest draft, confirmed PDF',
  )

  const count = (await list(page)).length
  await button(page, '新建简历').first().click()
  await button(page, '空白简历').click()
  await button(page, '选择模板').click()
  picker = page.locator('[data-template-picker]')
  await select(picker, 'F5')
  await button(picker, '应用此模板').click()
  await button(page.getByRole('dialog', { name: '新建简历' }), '取消').click()
  assert.equal((await list(page)).length, count)
  await button(page, '新建简历').first().click()
  await button(page, '空白简历').click()
  await button(page, '选择模板').click()
  picker = page.locator('[data-template-picker]')
  await select(picker, 'A2')
  await button(picker, '应用此模板').click()
  await page.getByLabel('文档名称').fill('台式机验收')
  await button(page, '创建并编辑').click()
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'A2')
  const created = (await list(page)).find((d) => d.name === '台式机验收')
  assert.equal(created.target, '')
  assert.ok(!created.photo)
  assert.equal((await list(page)).find((d) => d.id === baseline.id).target, '最新草稿')
  assert.notEqual(original, '最新草稿')
  console.log('PASS T14 create and cancel; chosen layout retained without demonstration data')
}
async function pagination({ app, page }) {
  await page.evaluate(async () => {
    const [d] = await window.studio.list()
    d.sections = d.sections.filter((s) => ['work', 'education', 'skills', 'evaluation'].includes(s.kind))
    for (const s of d.sections) {
      s.entries = s.entries.slice(0, 1)
      s.entries[0].blocks = []
      s.intro = []
      s.ending = []
      s.breakBefore = s.kind === 'work' || s.kind === 'skills'
    }
    await window.studio.save(d, d.revision)
  })
  await page.reload()
  await editFirst(page)
  await expect(readyDocument(page).locator('.paper-page')).toHaveCount(2)
  const picker = await openPicker(page)
  await select(picker, 'A1')
  await button(picker, '对比当前样式').click()
  const current = picker.locator('[data-template-pane=current]'),
    candidate = picker.locator('[data-template-pane=candidate]')
  await expect(current).toHaveAttribute('data-page-count', '2')
  await expect(candidate).toHaveAttribute('data-page-count', '3')
  const currentIndex = await current.getAttribute('data-preview-page')
  while (Number(await candidate.getAttribute('data-preview-page')) > 1)
    await button(candidate, '上一页').click()
  await button(candidate, '下一页').click()
  await button(candidate, '下一页').click()
  await expect(candidate).toHaveAttribute('data-preview-page', '3')
  await expect(current).toHaveAttribute('data-preview-page', currentIndex)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700))
  await expect(candidate).toHaveAttribute('data-preview-page', '3')
  await button(picker, '取消').click()
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', '00')
  console.log('PASS T04 independent page counts, page 3 reached, narrow comparison and cancel')
}
async function performanceRun({ page }) {
  await editFirst(page)
  const picker = await openPicker(page)
  const sampleIds = ['B1', 'A1', 'D2', 'F1', 'E4', 'C2']
  const result = await picker.evaluate(async (picker, ids) => {
    const times = []
    for (let i = 0; i < 56; i++) {
      const id = ids[i % ids.length]
      const start = performance.now()
      picker.querySelector('[data-template-option="' + id + '"]').click()
      for (;;) {
        await new Promise(requestAnimationFrame)
        if (
          picker.querySelector(
            '[data-template-pane="candidate"] [data-template-id="' + id + '"][data-layout-ready=true]',
          ) &&
          ![...picker.querySelectorAll('button')].find((b) => b.textContent.trim() === '应用此模板')?.disabled
        )
          break
        if (performance.now() - start > 5000) throw Error('Candidate layout timed out for ' + id)
      }
      await new Promise(requestAnimationFrame)
      if (i >= 6) times.push(performance.now() - start)
    }
    return times.sort((a, b) => a - b)
  }, sampleIds)
  const p95 = result[Math.ceil(result.length * 0.95) - 1]
  assert.ok(p95 <= 800, 'Template preview latency ' + p95)
  console.log('PASS T13', result.length, 'warm selections, P95', p95.toFixed(1), 'ms')
}
async function main() {
  await withProfile('template-interaction', interaction)
  await withProfile('template-compare', pagination)
  await withProfile('template-performance', performanceRun)
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
