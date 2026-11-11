const { _electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const ids = ['00', ...[...'ABCDEF'].flatMap((f) => [1, 2, 3, 4, 5].map((n) => f + n))]

async function launch(profile) {
  const executablePath =
    process.env.STUDIO_APP ||
    path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
  const app = await _electron.launch({ executablePath, env: { ...process.env, RESUME_STUDIO_HOME: profile } })
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    page.setDefaultTimeout(12000)
    await expect(page.locator('.doc-title').first()).toBeVisible()
    return { app, page }
  } catch (error) {
    await app.close()
    throw error
  }
}
async function withProfile(prefix, task, seedFile) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix + '-'))
  const profile = path.join(dir, 'profile')
  await fs.mkdir(profile)
  try {
    if (seedFile) await fs.copyFile(seedFile, path.join(profile, 'seed.json'))
    const { app, page } = await launch(profile)
    try {
      await task({ app, page, dir, profile })
    } finally {
      await app.close()
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
const readyDocument = (page) => page.locator('#print-root .paper-document[data-layout-ready="true"]')
async function openPicker(page) {
  await page.locator('.template-trigger').click()
  const picker = page.locator('[data-template-picker]')
  await expect(picker).toBeVisible()
  return picker
}
async function select(picker, id) {
  await picker.locator('[data-template-option="' + id + '"]').click()
  await expect(
    picker.locator(
      '[data-template-pane="candidate"] .paper-document[data-template-id="' +
        id +
        '"][data-layout-ready="true"]',
    ),
  ).toBeAttached()
}
module.exports = { ids, launch, withProfile, readyDocument, openPicker, select }
