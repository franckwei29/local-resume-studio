// Run on macOS after npm run package. All operations use a fresh temporary profile.
const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const binary =
  process.env.STUDIO_APP || path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-acceptance-')),
    profile = path.join(dir, 'profile'),
    output = path.join(dir, 'draft.pdf'),
    backup = path.join(dir, 'draft.resume.json')
  await fs.mkdir(profile)
  if (process.env.RESUME_TEST_SEED)
    await fs.copyFile(process.env.RESUME_TEST_SEED, path.join(profile, 'seed.json'))
  let app,
    p,
    errors = []
  const start = async () => {
    app = await electron.launch({
      executablePath: binary,
      env: { ...process.env, RESUME_STUDIO_HOME: profile },
    })
    p = await app.firstWindow()
    p.on('pageerror', (e) => errors.push(e.message))
    await p.context().setOffline(true)
    await expect(p.locator('.doc-card').first()).toBeVisible()
  }
  const button = (n) => p.getByRole('button', { name: n, exact: true })
  async function menu(name, id) {
    await button('文档操作 ' + name).click()
    await p.getByRole('menuitem', { name: id, exact: true }).click()
  }
  const docs = () => p.evaluate(() => window.studio.list())
  const savePath = (dest) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, dest)
  const openPath = (dest) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, dest)
  try {
    await start()
    const [base] = await docs()
    assert.equal(base.sections.find((s) => s.kind === 'education').entries.length, 2)
    assert.equal(base.sections.find((s) => s.kind === 'work').entries.length, 3)
    const name = '测试 · 开发岗'
    await menu(base.name, '复制')
    await p.getByLabel('文档名称').fill(name)
    await button('创建并编辑').click()
    await expect(p.locator('#print-root [data-layout-ready="true"]')).toBeVisible()
    const target = p.locator('[data-node-kind="target"] .re-toggle').first()
    if ((await target.getAttribute('aria-expanded')) !== 'true') await target.click()
    await p.getByRole('textbox', { name: '目标岗位', exact: true }).fill('离线软件工程师')
    await expect(p.locator('#print-root')).toContainText('离线软件工程师')
    const move = p.locator('[data-node-kind="skills"] [data-drag-id]').first()
    await move.dragTo(p.locator('[data-lane-end="main"]'))
    await expect(p.locator('[data-editor-lane="main"] [data-node-kind="skills"]')).toHaveCount(1)
    const num = await p.locator('#print-root .paper-page').count()
    await p.getByLabel('查看比例').selectOption('1.5')
    assert.equal(await p.locator('#print-root .paper-page').count(), num)
    await savePath(output)
    await button('导出 PDF').click()
    await expect(p.locator('.toast')).toContainText('已导出', { timeout: 20000 })
    const info = execFileSync('pdfinfo', [output], { encoding: 'utf8' })
    assert.match(info, /A4/)
    assert.match(info, new RegExp('Pages:\\s+' + num + '\\b'))
    const txt = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8' }).replace(/\s/g, '')
    assert.ok(txt.includes('离线软件工程师'))
    console.log('PASS A03/A14 copy, independent nested ordering, offline packaged edit and searchable PDF')
    await button('简历库').click()
    await app.close()
    await start()
    assert.equal((await docs()).find((d) => d.id === base.id).target, base.target)
    let draft = (await docs()).find((d) => d.name === name)
    assert.equal(draft.target, '离线软件工程师')
    assert.equal(draft.sections.find((s) => s.kind === 'skills').lane, 'main')
    await p.getByPlaceholder('搜索文档名称或目标岗位').fill('离线软件工程师')
    await expect(p.locator('.doc-card')).toHaveCount(1)
    await button('列表视图').click()
    await expect(p.locator('.doc-list .doc-card')).toHaveCount(1)
    await p.getByLabel('清除搜索').click()
    await menu(name, '重命名')
    await p.getByLabel('文档名称').fill(base.name)
    await button('保存').click()
    await expect(p.getByRole('alert')).toContainText('已被使用')
    await button('取消').click()
    await savePath(backup)
    await menu(name, '导出可编辑备份')
    await expect.poll(async () => !!(await fs.stat(backup).catch(() => null))).toBe(true)
    await menu(name, '移入回收站')
    await p.getByRole('dialog').getByRole('button', { name: '移入回收站' }).click()
    await p.locator('.sidebar nav button').filter({ hasText: '回收站' }).click()
    await menu(name, '恢复')
    await p.locator('.sidebar nav button').filter({ hasText: '简历库' }).click()
    await openPath(backup)
    await button('导入备份').click()
    await expect(p.locator('.workspace')).toBeVisible()
    await button('简历库').click()
    assert.equal((await docs()).filter((d) => !d.trashed).length, 3)
    console.log(
      'PASS A11 search, list, duplicate-name guard, trash/restore, editable backup round trip and restart',
    )
    await button('新建简历').first().click()
    await button('空白简历').click()
    await button('创建并编辑').click()
    await button('导出 PDF').click()
    await expect(p.locator('.toast').filter({ hasText: '请先添加' })).toBeVisible()
    assert.deepEqual(errors, [])
    console.log('PASS blank export validation; zero uncaught renderer errors')
  } finally {
    if (app) await app.close().catch(() => {})
    await fs.rm(dir, { recursive: true, force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
