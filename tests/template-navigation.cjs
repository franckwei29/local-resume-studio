const { expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const { withProfile, readyDocument, openPicker, select } = require('./template-harness.cjs')

// Freeze just the pending autosave timer. Releasing it performs the real SQLite write and IPC readback.
async function holdAutosave(page) {
  await page.evaluate(() => {
    const native = window.setTimeout
    window.setTimeout = function (callback, ms, ...args) {
      if (ms === 350 && typeof callback === 'function') {
        window.setTimeout = native
        window.releasePendingResumeSave = () => callback(...args)
        return native.call(window, () => {}, 0)
      }
      return native.call(window, callback, ms, ...args)
    }
  })
}

async function verify({ page }) {
  const { skills, firstSkill } = await page.evaluate(async () => {
    const [doc] = await window.studio.list()
    // Put late directory destinations on distinct pages, independent of installed font metrics.
    for (let i = 0; i < 5; i++) {
      const entry = {
        id: crypto.randomUUID(),
        fields: { name: '公开样例 ' + i },
        start: '',
        end: '',
        current: false,
        blocks: [],
      }
      doc.sections.push({
        id: crypto.randomUUID(),
        kind: 'custom',
        title: '附录 ' + i,
        customTitle: true,
        lane: 'main',
        intro: [],
        ending: [],
        entries: [entry],
        breakBefore: true,
      })
    }
    await window.studio.save(doc, doc.revision)
    const skills = doc.sections.find((s) => s.kind === 'skills')
    return { skills: skills.id, firstSkill: skills.entries[0].id }
  })
  await page.reload()
  await page.locator('.doc-title').first().click()
  await expect(readyDocument(page)).toBeAttached()
  await page.locator('[data-node-kind="target"] > .re-rowhead .re-toggle').click()
  await holdAutosave(page)
  await page.getByRole('textbox', { name: '目标岗位', exact: true }).fill('本地试排与定位')
  const picker = await openPicker(page)
  await select(picker, 'F2')
  const candidate = picker.locator('[data-template-pane=candidate]')
  while (Number(await candidate.getAttribute('data-preview-page')) > 1) {
    await candidate.getByRole('button', { name: '上一页', exact: true }).click()
  }
  const lastIndexLink = candidate.getByRole('link', { name: /另有/ }).first()
  await expect(lastIndexLink).toBeVisible()
  const destination = await lastIndexLink.evaluate((a) => {
    const node = document.getElementById(decodeURIComponent(a.hash.slice(1)))
    return Number(node.closest('.paper-page').dataset.pageIndex) + 1
  })
  assert.ok(destination > 1, 'Test section must be on a later page')
  await lastIndexLink.click()
  await expect(candidate).toHaveAttribute('data-preview-page', String(destination))
  await page.evaluate(() => window.releasePendingResumeSave())
  await expect(page.locator('.save-status')).toContainText('已保存在本机')
  await expect(candidate).toHaveAttribute('data-preview-page', String(destination))
  await expect(picker.locator('[data-template-status]')).not.toContainText('简历已更新')
  await select(picker, 'E3')
  await picker.getByRole('button', { name: '应用此模板', exact: true }).click()
  await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'E3')
  const module = page.locator('[data-editor-id="' + skills + '"] > .re-rowhead .re-toggle')
  if ((await module.getAttribute('aria-expanded')) !== 'true') await module.click()
  await expect(page.locator('[data-editor-id="' + firstSkill + '"] > .re-rowhead')).toContainText('首页导读')
  const reopened = await openPicker(page)
  await expect(reopened.locator('[data-template-option="E3"]')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(reopened.locator('[data-template-option="E4"]')).toBeFocused()
  await expect(reopened.locator('[data-template-option="E3"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('.template-trigger')).toBeFocused()
  const [stored] = await page.evaluate(() => window.studio.list())
  assert.equal(stored.target, '本地试排与定位')
  console.log(
    'PASS T02/T03/T08 directory target navigates the candidate page, pending autosave preserves page and selection, featured entry and keyboard focus',
  )
}
withProfile('template-navigation', verify).catch((e) => {
  console.error(e)
  process.exitCode = 1
})
