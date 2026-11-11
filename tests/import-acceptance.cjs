const { _electron } = require('@playwright/test')
const { strict: assert } = require('node:assert')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { makeImportFixtures } = require('./fixtures/make-imports.cjs')

async function run() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-file-check-'))
  let app
  try {
    await makeImportFixtures(home)
    const executable = process.env.RESUME_STUDIO_EXECUTABLE
    app = await _electron.launch({
      args: executable ? [] : ['.'],
      ...(executable ? { executablePath: executable } : {}),
      env: { ...process.env, RESUME_STUDIO_HOME: home },
      timeout: 90000,
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    const btn = (name) => page.getByRole('button', { name, exact: true })
    await page.getByRole('heading', { name: '我的简历' }).waitFor()
    const initialDocs = await page.evaluate(() => window.studio.list())
    const initial = initialDocs.length
    for (const [file, expected] of [
      ['education.docx', '北湖大学'],
      ['text.pdf', 'North Lake University'],
      ['scanned.pdf', 'North Lake University'],
    ]) {
      await btn('新建简历').first().click()
      await btn('从文件导入').click()
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
        },
        path.join(home, file),
      )
      await btn('选择 PDF 或 Word').click()
      await page.getByRole('heading', { name: '核对字段' }).waitFor({ timeout: 120000 })
      const records = page.locator('.import-record')
      const count = await records.count()
      let educationRows = 0,
        first = -1
      for (let i = 0; i < count; i++) {
        await records.nth(i).click()
        if ((await page.locator('.import-fields select').inputValue()) === 'education') {
          educationRows++
          if ((await page.getByLabel('学校', { exact: true }).inputValue()) === expected) first = i
        } else {
          await page.getByLabel('跳过此条').check()
        }
      }
      assert.equal(educationRows, 2)
      assert(first >= 0)
      await records.nth(first).click()
      assert.equal(await page.getByLabel('学校', { exact: true }).inputValue(), expected)
      await btn('合并下一条').click()
      assert.equal(await records.count(), count - 1)
      await page.locator('.import-fields textarea').focus()
      await btn('在光标处拆分').click()
      assert.equal(await records.count(), count)
      await page.getByLabel('学校', { exact: true }).fill('第二所学校')
      await page.locator('.import-fields select').selectOption('custom')
      await page.getByLabel('标题 / 名称', { exact: true }).fill('校内研究')
      if (file.endsWith('.docx')) {
        await page.locator('.import-fields select').selectOption('education')
        await page.getByLabel('专业', { exact: true }).fill('应用数学')
        await page.getByLabel('学位', { exact: true }).fill('本科')
        await page.getByLabel('开始年月', { exact: true }).fill('2018-09')
      }
      await btn('创建并编辑').click()
      await page.locator('#print-root .paper-page').first().waitFor()
      const stored = (await page.evaluate(() => window.studio.list())).find(
        (doc) => doc.name === file.split('.')[0],
      )
      assert(stored)
      assert(stored.sections.some((sec) => sec.kind === 'education'))
      if (file.endsWith('.docx')) {
        const records = stored.sections.find((sec) => sec.kind === 'education').entries
        assert.equal(records.length, 2)
        assert.equal(records[0].fields.school, '北湖大学')
        assert.equal(records[1].fields.school, '第二所学校')
        assert.equal(records[1].start, '2018-09')
      } else {
        assert(stored.sections.some((sec) => sec.kind === 'custom'))
      }
      await page.locator('.work-header .back').click()
      console.log('PASS actual import dialog, review, merge, split, reclassify, create:', file)
    }
    await btn('新建简历').first().click()
    await btn('从文件导入').click()
    await btn('‹ 简历库').click()
    assert.equal((await page.evaluate(() => window.studio.list())).length, initial + 3)
    await btn('打开 ' + initialDocs[0].name).click()
    await page.locator('#print-root .paper-page').first().waitFor()
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true })
    })
    await btn('导出 PDF').click()
    await btn('导出 PDF').waitFor()
    assert.equal(await page.getByText(/^已导出 /).count(), 0)
    // ENOTDIR is deterministic, also on a writable CI machine.
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
      },
      path.join(home, 'text.pdf', 'cannot-write.pdf'),
    )
    await btn('导出 PDF').click()
    await page.getByText(/导出失败/).waitFor()
    const result = path.join(home, 'retried.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, result)
    await btn('重试').click()
    await page.getByText('已导出 retried.pdf').waitFor()
    assert((await fs.readFile(result)).subarray(0, 5).equals(Buffer.from('%PDF-')))
    console.log('PASS A13 real export cancel, write failure and retry')
  } finally {
    if (app) await app.close()
    await fs.rm(home, { recursive: true, force: true })
  }
}
run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
