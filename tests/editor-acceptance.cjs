const { _electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-editor-'))
  if (process.env.RESUME_TEST_SEED)
    await fs.copyFile(process.env.RESUME_TEST_SEED, path.join(home, 'seed.json'))
  let app
  try {
    const binary = process.env.RESUME_STUDIO_EXECUTABLE
    app = await _electron.launch({
      ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }),
      env: { ...process.env, RESUME_STUDIO_HOME: home },
      timeout: 90000,
    })
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    page.setDefaultTimeout(12000)
    const btn = (name) => page.getByRole('button', { name, exact: true })
    const row = (id) => page.locator('[data-editor-id="' + id + '"]')
    const lines = (id) => page.locator('#print-root [data-source-id="' + id + '"]')
    const toggle = (id) => row(id).locator(':scope > .re-rowhead .re-toggle')
    const open = async (id) => {
      if ((await toggle(id).getAttribute('aria-expanded')) === 'false') await toggle(id).click()
    }
    const close = async (id) => {
      if ((await toggle(id).getAttribute('aria-expanded')) === 'true') await toggle(id).click()
    }
    const opt = async (id, text) => {
      await row(id).locator(':scope > .re-rowhead .re-icon').click()
      await page.getByRole('menuitem', { name: text, exact: true }).click()
    }
    const saved = async () => {
      await expect(page.locator('.save-status')).toContainText('已保存在本机')
      return (await page.evaluate(() => window.studio.list()))[0]
    }
    const drag = async (from, to) => {
      const source = row(from).locator(':scope > .re-rowhead [data-drag-id]')
      const target = row(to).locator(':scope > .re-rowhead')
      await source.dragTo(target, { targetPosition: { x: 15, y: 4 } })
    }
    const checkOrder = async (parent, sel, arr) =>
      assert.deepEqual(
        await parent.locator(sel).evaluateAll((els) => els.map((e) => e.dataset.editorId)),
        arr,
      )
    const waitPaper = () => page.locator('#print-root .paper-document[data-layout-ready="true"]').waitFor()
    await page.locator('.doc-card .sheet-cover').first().click()
    await waitPaper()
    let d = await saved()
    const sec = (k) => d.sections.find((s) => s.kind === k),
      work = sec('work'),
      edu = sec('education'),
      skills = sec('skills'),
      projects = sec('project')
    const originalRole = work.entries[0],
      groups = originalRole.blocks.filter((b) => b.type === 'group'),
      bullet = groups[0].children[0]
    console.log('Checking A04 editor composition and formatting…')
    await open(work.id)
    await open(originalRole.id)
    await open(groups[0].id)
    await open(bullet.id)
    const rich = row(bullet.id).getByRole('textbox', { name: '正文', exact: true })
    await rich.click()
    await rich.press('ControlOrMeta+End')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '中文组合', selectionStart: 4, selectionEnd: 4 })
    await cdp.send('Input.insertText', { text: '中文组合' })
    await expect(rich).toBeFocused()
    await expect.poll(async () => (await lines(bullet.id).allTextContents()).join('')).toContain('中文组合')
    await rich.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const p = n.textContent.indexOf('中文组合')
        if (p < 0) continue
        const r = document.createRange()
        r.setStart(n, p)
        r.setEnd(n, p + 4)
        const s = getSelection()
        s.removeAllRanges()
        s.addRange(r)
        break
      }
    })
    await row(bullet.id).getByRole('button', { name: '粗体', exact: true }).click()
    let seen = await saved()
    const savedBullet = seen.sections
      .find((s) => s.id === work.id)
      .entries[0].blocks.find((b) => b.id === groups[0].id).children[0]
    assert(savedBullet.runs.some((r) => r.bold && r.text.includes('中文组合')))
    await expect(rich).toBeFocused()
    console.log('PASS A04 Chromium IME, selected span bold, focus and live preview')
    await close(bullet.id)
    await close(groups[0].id)
    await close(originalRole.id)
    await close(work.id)

    console.log('Checking A05 drag, undo and redo…')
    await drag(work.id, edu.id)
    const mainList = page.locator('[data-editor-lane="main"]')
    await checkOrder(mainList, ':scope > .re-section', [work.id, edu.id, projects.id])
    await btn('撤销').click()
    await checkOrder(mainList, ':scope > .re-section', [edu.id, work.id, projects.id])
    await btn('重做').click()
    await checkOrder(mainList, ':scope > .re-section', [work.id, edu.id, projects.id])
    await btn('撤销').click()
    await open(work.id)
    await drag(work.entries[2].id, originalRole.id)
    await checkOrder(row(work.id), ':scope > .re-nodebody > .re-entries > .re-entry', [
      work.entries[2].id,
      originalRole.id,
      work.entries[1].id,
    ])
    await btn('撤销').click()
    await open(originalRole.id)
    await drag(groups[1].id, groups[0].id)
    await expect
      .poll(async () =>
        (
          await row(originalRole.id)
            .locator(':scope > .re-nodebody > .re-blockset > .re-block')
            .evaluateAll((els) => els.map((e) => e.dataset.editorId))
        ).indexOf(groups[1].id),
      )
      .toBe(1)
    await btn('撤销').click()
    await open(groups[0].id)
    await drag(groups[0].children[1].id, bullet.id)
    await checkOrder(row(groups[0].id), ':scope > .re-nodebody > .re-blockset > .re-block', [
      groups[0].children[1].id,
      bullet.id,
    ])
    await btn('撤销').click()
    await close(work.id)
    console.log('PASS A05 four levels of drag with undo / redo')
    await open(projects.id)
    const firstProject = projects.entries[0],
      secondProject = projects.entries[1]
    await opt(secondProject.id, '从这里另起一页')
    await row(secondProject.id)
      .locator('.re-break-grip')
      .dragTo(row(firstProject.id).locator(':scope > .re-rowhead'), { targetPosition: { x: 12, y: 3 } })
    await expect(row(firstProject.id).locator(':scope > .re-break')).toHaveCount(1)
    await expect(row(secondProject.id).locator(':scope > .re-break')).toHaveCount(0)
    await row(firstProject.id).getByRole('button', { name: '移除分页', exact: true }).click()
    await close(projects.id)
    console.log('PASS explicit break drag/rebind/remove')

    await row(skills.id)
      .locator(':scope > .re-rowhead [data-drag-id]')
      .dragTo(page.locator('[data-lane-end="main"]'), { targetPosition: { x: 12, y: 5 } })
    await expect(mainList.locator('[data-editor-id="' + skills.id + '"]')).toBeVisible()
    await open(skills.id)
    const sk = skills.entries[0]
    await opt(sk.id, '隐藏')
    await expect(lines(sk.id)).toHaveCount(0)
    await opt(skills.id, '隐藏')
    await expect(lines(skills.id)).toHaveCount(0)
    await opt(skills.id, '显示')
    await expect(lines(sk.id)).toHaveCount(0)
    for (const remaining of skills.entries.slice(1)) assert((await lines(remaining.id).count()) > 0)
    await btn('撤销').click()
    await btn('撤销').click()
    await btn('撤销').click()
    await btn('撤销').click()
    console.log('PASS A06 cross-column drag, nested visibility and restore')

    await btn('排版').click()
    const snapshot = () =>
      page
        .locator('#print-root .paper-line')
        .evaluateAll((els) => els.map((e) => [e.dataset.sourceId, e.dataset.y, e.style.left, e.textContent]))
    const css = await snapshot()
    for (const label of ['行高', '条目间距', '模块间距']) {
      const previous = await snapshot()
      await btn('增大' + label).click()
      assert.notDeepEqual(await snapshot(), previous)
    }
    await btn('恢复模板默认值').click()
    await waitPaper()
    assert.deepEqual(await snapshot(), css)
    await btn('关闭排版').click()
    await page.getByLabel('查看比例').selectOption('1.5')
    assert.deepEqual(await snapshot(), css)
    await page.getByLabel('查看比例').selectOption('fit')
    console.log('PASS A08 independent style changes, default restoration and display-only zoom')

    await open(work.id)
    await open(work.entries[1].id)
    const invalid = row(work.entries[1].id)
    await invalid.getByLabel('结束年月', { exact: true }).fill('2011-01')
    await expect(invalid.getByRole('alert')).toContainText('结束年月早于')
    await btn('导出 PDF').click()
    await expect(page.getByRole('status')).toContainText('结束年月')
    await saved()
    await page.locator('.work-header .back').click()
    await page.locator('.doc-card .sheet-cover').first().click()
    await open(work.id)
    await open(work.entries[1].id)
    assert.equal(await invalid.getByLabel('结束年月', { exact: true }).inputValue(), '2011-01')
    await invalid.getByLabel('结束年月', { exact: true }).fill(work.entries[1].end)
    await row(work.id).getByRole('button', { name: '添加工作', exact: true }).click()
    const newEntry = (await saved()).sections.find((s) => s.id === work.id).entries.at(-1)
    assert.notEqual(newEntry.id, work.entries.at(-1).id)
    await expect(lines(newEntry.id)).toHaveCount(0)
    await close(work.id)
    await open(projects.id)
    await row(projects.id).getByRole('button', { name: '添加项目', exact: true }).click()
    const blankProject = (await saved()).sections.find((s) => s.id === projects.id).entries.at(-1)
    for (const empty of [blankProject, ...blankProject.blocks]) await expect(lines(empty.id)).toHaveCount(0)
    console.log(
      'PASS A10 blank rows including project starter fields, invalid date, draft persistence, export validation and recovery',
    )

    await page.locator('.re-headertoggle').click()
    const header = row('header')
    await header.getByRole('checkbox', { name: '使用目标岗位作为标题' }).check()
    await expect(page.locator('.paper-cover-title').first()).toHaveText(d.target)
    const originalPhoto = d.photo
    await btn('编辑照片').click()
    const crop = page.getByRole('dialog', { name: '裁剪照片' })
    await crop.getByLabel('照片缩放').fill('1.6')
    await crop.getByRole('button', { name: '取消' }).click()
    assert.deepEqual((await saved()).photo, originalPhoto)
    await btn('编辑照片').click()
    await crop.getByLabel('照片缩放').fill('1.5')
    await crop.getByRole('button', { name: '↷ 向右旋转' }).click()
    const canvas = crop.locator('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + 95, box.y + 95)
    await page.mouse.down()
    await page.mouse.move(box.x + 112, box.y + 98)
    await page.mouse.up()
    await crop.getByRole('button', { name: '应用' }).click()
    const applied = (await saved()).photo
    assert.equal(applied.zoom, 1.5)
    assert.equal(applied.rotation, 90)
    assert.notEqual(applied.x, 0.5)
    const before = Number(await lines(sec('personal').id).first().getAttribute('data-y'))
    await btn('移除照片').click()
    await expect(page.locator('#print-root .paper-photo')).toHaveCount(0)
    const after = Number(await lines(sec('personal').id).first().getAttribute('data-y'))
    assert(after < before)
    console.log('PASS A15 target heading, circular crop cancel / apply / drag / rotate / remove')

    await page.getByRole('button', { name: '添加模块到简历右栏' }).click()
    await page.getByRole('menuitem', { name: '自定义段落', exact: true }).click()
    const custom = (await saved()).sections.at(-1)
    await row(custom.id).getByLabel('名称', { exact: true }).fill('社区课程')
    await opt(custom.id, '修改模块标题')
    await row(custom.id).getByLabel('模块标题', { exact: true }).fill('专利与成果')
    await btn('栏目语言').click()
    await expect(lines(work.id).first()).toHaveText('Work experience')
    await expect(lines(custom.id).first()).toHaveText('专利与成果')
    await expect.poll(async () => (await lines(bullet.id).allTextContents()).join('')).toContain('中文组合')
    console.log('PASS A16 English built-ins preserve authored titles and CJK content')
  } finally {
    if (app) await app.close()
    await fs.rm(home, { recursive: true, force: true })
  }
}
main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
