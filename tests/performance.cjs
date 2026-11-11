// Benchmark renderer input to two animation frames after the updated paper is visible.
const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path')
const assert = require('node:assert/strict')
async function run() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-perf-'))
  if (process.env.STUDIO_BENCH_SEED)
    await fs.copyFile(process.env.STUDIO_BENCH_SEED, path.join(folder, 'seed.json'))
  const binary =
    process.env.STUDIO_APP ||
    path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
  const app = await electron.launch({
    executablePath: binary,
    env: { ...process.env, RESUME_STUDIO_HOME: folder },
  })
  try {
    const p = await app.firstWindow()
    await p.context().setOffline(true)
    await p.locator('.doc-title').click()
    await expect(p.locator('#print-root .paper-document[data-layout-ready="true"]')).toBeVisible()
    await p.locator('[data-node-kind="target"] .re-toggle').click()
    const tb = p.getByRole('textbox', { name: '目标岗位', exact: true })
    await tb.fill('软件工程师0')
    await expect(p.locator('#print-root')).toContainText('软件工程师0')
    const field = [],
      size = []
    for (let i = 0; i < 54; i++) {
      const value = '软件工程师' + (i + 1)
      await p.evaluate((expected) => {
        const field = document.querySelector('input[aria-label="目标岗位"]')
        window.measurement = new Promise((resolve) =>
          field.addEventListener(
            'input',
            () => {
              const start = performance.now()
              function frame() {
                const paper = document.querySelector('#print-root [data-layout-ready="true"]')
                if (!paper?.textContent.includes(expected)) {
                  requestAnimationFrame(frame)
                  return
                }
                requestAnimationFrame(() => resolve(performance.now() - start))
              }
              requestAnimationFrame(frame)
            },
            { once: true, capture: true },
          ),
        )
      }, value)
      await tb.fill(value)
      const ms = await p.evaluate(() =>
        Promise.race([
          window.measurement,
          new Promise((_, reject) => setTimeout(() => reject(Error('界面测量超时')), 3000)),
        ]),
      )
      if (i > 2) field.push(ms)
    }
    await p.getByRole('button', { name: '排版', exact: true }).click()
    for (let i = 0; i < 54; i++) {
      const increase = i % 2 === 0,
        label = increase ? '增大正文字号' : '减小正文字号'
      await p.evaluate((label) => {
        const control = document.querySelector('button[aria-label="' + label + '"]')
        const current = document.querySelector('#print-root .paper-line span[style*="10.25pt"]') !== null
        window.measurement = new Promise((resolve) =>
          control.addEventListener(
            'click',
            () => {
              const start = performance.now()
              function frame() {
                const changed = !!document.querySelector('#print-root .paper-line span[style*="10.25pt"]')
                if (changed === current) {
                  requestAnimationFrame(frame)
                  return
                }
                requestAnimationFrame(() => resolve(performance.now() - start))
              }
              requestAnimationFrame(frame)
            },
            { once: true, capture: true },
          ),
        )
      }, label)
      await p.getByRole('button', { name: label, exact: true }).click()
      const ms = await p.evaluate(() =>
        Promise.race([
          window.measurement,
          new Promise((_, reject) => setTimeout(() => reject(Error('界面测量超时')), 3000)),
        ]),
      )
      if (i > 2) size.push(ms)
    }
    function p95(v) {
      return +v.sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1].toFixed(2)
    }
    console.log(JSON.stringify({ samples: field.length, fieldP95: p95(field), globalSizeP95: p95(size) }))
    assert.ok(p95(field) <= 200)
    assert.ok(p95(size) <= 500)
  } finally {
    await app.close()
    await fs.rm(folder, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
