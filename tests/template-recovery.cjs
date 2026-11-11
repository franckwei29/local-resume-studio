// Packaged desktop fault/recovery and multi-template backup tests. Every write uses a new test profile.
const { expect } = require('@playwright/test')
const { DatabaseSync } = require('node:sqlite')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { launch, openPicker, readyDocument, select } = require('./template-harness.cjs')

async function run() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-template-recovery-'))
  const profile = path.join(folder, 'profile')
  await fs.mkdir(profile)
  let app, page, db
  const start = async () => ({ app, page } = await launch(profile))
  const btn = (name) => page.getByRole('button', { name, exact: true })
  const docs = () => page.evaluate(() => window.studio.list())
  const menu = async (name, action) => {
    await btn('文档操作 ' + name).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  async function apply(id) {
    const picker = await openPicker(page)
    await select(picker, id)
    await picker.getByRole('button', { name: '应用此模板', exact: true }).click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', id)
  }
  try {
    await start()
    const [base] = await docs()
    await page.locator('.doc-title').first().click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', '00')
    await page.locator('[data-node-kind="target"] > .re-rowhead > .re-toggle').click()
    const field = page.getByRole('textbox', { name: '目标岗位', exact: true })
    const lastInput = base.target + '末字辰'
    await field.fill(lastInput)
    const picker = await openPicker(page)
    const candidate = picker.locator('[data-template-pane="candidate"]')
    const commit = picker.getByRole('button', { name: '应用此模板', exact: true })
    await expect(candidate).toContainText(lastInput)
    await expect.poll(async () => (await docs())[0].target).toBe(lastInput)
    const before = (await docs())[0]

    // Defer the first new serif font request. Reject the abandoned request only after C3 has rendered.
    await page.evaluate(() => {
      const prototype = Object.getPrototypeOf(document.fonts)
      const realLoad = prototype.load
      window.fontFault = {
        mode: 'hold',
        pending: [],
        restore: () => {
          prototype.load = realLoad
        },
      }
      prototype.load = function (font, text) {
        if (!/Serif/i.test(font)) return realLoad.call(this, font, text)
        const fault = window.fontFault
        if (fault.mode === 'hold') return new Promise((_, reject) => fault.pending.push(reject))
        if (fault.mode === 'fail') return Promise.reject(Error('Injected local serif font failure'))
        return realLoad.call(this, font, text)
      }
    })
    await picker.locator('[data-template-option="A1"]').click()
    await expect.poll(() => page.evaluate(() => window.fontFault.pending.length)).toBeGreaterThan(0)
    await expect(commit).toBeDisabled()
    await select(picker, 'B1')
    await select(picker, 'C3')
    await expect(commit).toBeEnabled()
    await page.evaluate(() => {
      window.fontFault.mode = 'fail'
      for (const reject of window.fontFault.pending.splice(0)) reject(Error('Late, discarded A1 layout'))
    })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await expect(candidate.locator('.paper-document')).toHaveAttribute('data-template-id', 'C3')
    await expect(commit).toBeEnabled()
    await expect(candidate.getByRole('alert')).toHaveCount(0)
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    assert.deepEqual((await docs())[0], before)
    console.log(
      'PASS T03 retained last input, delayed abandoned font completion, cancel and snapshot isolation',
    )

    const retryPicker = await openPicker(page)
    await retryPicker.locator('[data-template-option="A1"]').click()
    const alert = retryPicker.locator('[data-template-pane="candidate"]').getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(retryPicker.getByRole('button', { name: '应用此模板', exact: true })).toBeDisabled()
    assert.deepEqual((await docs())[0], before)
    await page.evaluate(() => window.fontFault.restore())
    await alert.getByRole('button', { name: '重新排版' }).click()
    const applyButton = retryPicker.getByRole('button', { name: '应用此模板', exact: true })
    await expect(applyButton).toBeEnabled()
    // Trigger a real SQLite transaction failure after the user confirms the valid retry.
    db = new DatabaseSync(path.join(profile, 'resumes.sqlite'))
    db.exec(
      "CREATE TRIGGER acceptance_write_error BEFORE UPDATE ON docs BEGIN SELECT RAISE(ABORT,'simulated disk write error'); END",
    )
    await applyButton.click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'A1')
    await expect(page.locator('.error-banner')).toContainText('simulated disk write error')
    assert.deepEqual((await docs())[0], before)
    const latest = lastInput + '最新重试'
    await field.fill(latest)
    db.exec('DROP TRIGGER acceptance_write_error')
    const file = path.join(folder, 'retry.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, file)
    await page.locator('.error-banner').getByRole('button', { name: '重试', exact: true }).click()
    await btn('导出 PDF').click()
    await expect
      .poll(() =>
        fs.stat(file).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true)
    assert(
      execFileSync('pdftotext', ['-raw', file, '-'], { encoding: 'utf8' })
        .replace(/\s/gu, '')
        .includes(latest),
    )
    const retried = (await docs())[0]
    assert.equal(retried.templateId, 'A1')
    assert.equal(retried.target, latest)
    console.log(
      'PASS T12 recover failed candidate, rollback failed write, edit, retry, immediate searchable PDF',
    )

    await btn('排版').click()
    await btn('增大正文字号').click()
    await btn('关闭排版').click()
    await apply('C2')
    await btn('简历库').click()
    const backup = path.join(folder, 'versions.resume.json')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, backup)
    await menu(base.name, '导出可编辑备份')
    await expect
      .poll(() =>
        fs.stat(backup).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true)
    const json = JSON.parse(await fs.readFile(backup, 'utf8'))
    assert.equal(json.templateId, 'C2')
    assert.equal(json.templateLayouts.A1.style.size, 10.25)
    assert.equal(json.templateLayouts['00'].style.margin, 5)
    await menu(base.name, '复制')
    const copyName = '独立模板副本'
    await page.getByLabel('文档名称').fill(copyName)
    await btn('创建并编辑').click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'C2')
    await btn('简历库').click()
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, backup)
    await btn('导入备份').click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'C2')
    await btn('简历库').click()
    const beforeRestart = await docs()
    assert.equal(beforeRestart.length, 3)
    for (const document of beforeRestart) {
      const sectionIds = new Set(document.sections.map((s) => s.id))
      assert.equal(document.templateLayouts.A1.style.size, 10.25)
      for (const layout of Object.values(document.templateLayouts))
        for (const pos of layout.sections) assert(sectionIds.has(pos.id))
    }
    db.close()
    db = null
    await app.close()
    app = null
    await start()
    assert.deepEqual(await docs(), beforeRestart)
    await btn(copyName).click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'C2')
    await apply('A1')
    await expect.poll(async () => (await docs()).find((d) => d.name === copyName).templateId).toBe('A1')
    const keyed = (await docs()).find((d) => d.name === copyName)
    assert.equal(keyed.style.size, 10.25)
    assert((await docs()).filter((d) => d.name !== copyName).every((d) => d.templateId === 'C2'))
    console.log(
      'PASS T11/T14 real editable backup, independent copy, restore, relaunch, inactive preferences and isolation',
    )
    await btn('简历库').click()
    const crop = { x: 0.3, y: 0.7, zoom: 1.9, rotation: 90 }
    await page.evaluate(
      async ({ id, crop }) => {
        const doc = (await window.studio.list()).find((d) => d.id === id)
        const personal = doc.sections.find((s) => s.kind === 'personal')
        personal.entries = []
        doc.sections = [personal]
        doc.templateLayouts = {}
        doc.target = ''
        doc.photo = { ...doc.photo, ...crop }
        await window.studio.save(doc, doc.revision)
      },
      { id: keyed.id, crop },
    )
    await page.reload()
    await btn(copyName).click()
    await expect(readyDocument(page)).toHaveAttribute('data-template-id', 'A1')
    await btn('导出 PDF').click()
    await expect(page.locator('.toast')).toContainText('当前模板没有可导出的内容')
    await apply('B4')
    await expect(readyDocument(page).locator('.paper-photo img')).toBeVisible()
    assert.match(await readyDocument(page).locator('.paper-photo img').getAttribute('style'), /90deg/)
    await btn('简历库').click()
    const addresses = await page.evaluate(async (id) => {
      const doc = (await window.studio.list()).find((d) => d.id === id)
      const values = [
        { icon: 'email', label: '邮箱', value: 'resume.research.'.repeat(10) + 'case@example.org' },
        {
          icon: 'other',
          label: '研究主页',
          value: 'https://example.org/projects/' + 'reference/'.repeat(14),
        },
      ]
      doc.sections[0].entries = values.map((fields) => ({
        id: crypto.randomUUID(),
        fields,
        start: '',
        end: '',
        current: false,
        blocks: [],
      }))
      await window.studio.save(doc, doc.revision)
      return doc.sections[0].entries.map((e) => ({ id: e.id, value: e.fields.value }))
    }, keyed.id)
    await page.reload()
    await btn(copyName).click()
    await apply('A1')
    await expect(readyDocument(page).locator('.paper-photo img')).toHaveCount(0)
    for (const contact of addresses) {
      const lines = readyDocument(page).locator('[data-source-id="' + contact.id + '"]')
      assert((await lines.allTextContents()).join('').replace(/\s/gu, '').includes(contact.value))
      await lines.first().click()
      await expect(
        page.locator('[data-editor-id="' + contact.id + '"]').getByLabel('字段值', { exact: true }),
      ).toHaveValue(contact.value)
    }
    await apply('B4')
    await expect(readyDocument(page).locator('.paper-photo img')).toBeVisible()
    await expect.poll(async () => (await docs()).find((d) => d.id === keyed.id).templateId).toBe('B4')
    const { src, ...returnedCrop } = (await docs()).find((d) => d.id === keyed.id).photo
    assert.deepEqual(returnedCrop, crop)
    assert.equal(src, base.photo.src)
    console.log(
      'PASS T09 visible-content export guard, rectangular portrait crop, long contact text and click-to-field',
    )
  } finally {
    if (db) db.close()
    if (app) await app.close().catch(() => {})
    await fs.rm(folder, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
