// Packaged Electron test. Set RESUME_TEST_SEED to an optional local baseline JSON.
// The output contains geometry and timing only; all test documents stay in a temporary profile.
const { _electron, expect } = require('@playwright/test')
const { PNG } = require('playwright-core/lib/utilsBundle')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const binary =
  process.env.STUDIO_APP || path.resolve('release/简历工坊-darwin-arm64/简历工坊.app/Contents/MacOS/简历工坊')
const percentile95 = (xs) => xs.sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]
const norm = (t) => t.normalize('NFKC').replace(/[\s\u200b\u00ad]/gu, '')
function decoded(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
function verifyTextLines(xml, expected) {
  const pages = [...xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)]
  assert.equal(pages.length, expected.length)
  let count = 0
  for (let i = 0; i < pages.length; i++) {
    const [, w, h, body] = pages[i]
    assert.ok(Math.abs((w / 72) * 25.4 - 210) < 0.4 && Math.abs((h / 72) * 25.4 - 297) < 0.4)
    const words = [
      ...body.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g,
      ),
    ].map((m) => ({ x: (+m[1] * 25.4) / 72, y: (((+m[2] + +m[4]) / 2) * 25.4) / 72, text: decoded(m[5]) }))
    for (const row of expected[i]) {
      // Poppler bounds include the full font ascender/descender. Select the
      // closest preview baseline in this lane so adjacent lines never overlap.
      const sameLane = expected[i].filter((o) => o.side === row.side)
      const candidates = words
        .filter((word) => {
          if (word.x < 72 !== row.side) return false
          const closest = sameLane.reduce((best, line) =>
            Math.abs(word.y - line.center) < Math.abs(word.y - best.center) ? line : best,
          )
          return closest === row && Math.abs(row.center - word.y) < 3.8
        })
        .sort((a, b) => a.x - b.x)
      const extracted = norm(candidates.map((c) => c.text).join(''))
      // The title/photo lives outside normal lines. Cover text cannot pass the
      // vertical distance cutoff above. Normalize presentation ligatures/spaces.
      assert.equal(
        extracted,
        norm(row.text),
        'PDF and preview line differ on page ' + (i + 1) + ' at ' + row.center.toFixed(1) + 'mm',
      )
      count++
    }
  }
  return count
}
function matchRegion(preview, pdf, region) {
  const scale = preview.width / 210
  const [x0, y0, x1, y1] = region.map((v) => Math.round(v * scale))
  let best = { score: Infinity, dx: 0, dy: 0 }
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) {
      let score = 0,
        samples = 0
      for (let y = y0; y < Math.min(preview.height - 6, y1); y++)
        for (let x = x0; x < Math.min(preview.width - 6, x1); x++) {
          const a = (y * preview.width + x) * 4,
            b = ((y + dy) * pdf.width + x + dx) * 4
          const ca = preview.data[a],
            cb = pdf.data[b]
          if (ca > 245 && cb > 245) continue
          score += Math.abs(ca - cb)
          samples++
        }
      score /= Math.max(1, samples)
      if (score < best.score) best = { score, dx, dy }
    }
  assert.ok(
    best.score < 55,
    'Raster content differs within measured region: ' + JSON.stringify({ ...best, region }),
  )
  const drift = Math.hypot(best.dx, best.dy) / scale
  assert.ok(drift <= 1, 'PDF drift exceeds 1 mm: ' + JSON.stringify({ ...best, drift, region }))
  return drift
}
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-paper-'))
  let app
  try {
    if (process.env.RESUME_TEST_SEED)
      await fs.copyFile(process.env.RESUME_TEST_SEED, path.join(dir, 'seed.json'))
    app = await _electron.launch({ executablePath: binary, env: { ...process.env, RESUME_STUDIO_HOME: dir } })
    const p = await app.firstWindow()
    await p.context().setOffline(true)
    await p.locator('.doc-title').first().click()
    const root = p.locator('#print-root')
    const ready = () => expect(root.locator('[data-layout-ready=true]')).toHaveCount(1)
    await ready()
    const [base] = await p.evaluate(() => window.studio.list())
    const sec = (kind) => base.sections.find((s) => s.kind === kind)
    for (const [kind, n] of Object.entries({
      education: 2,
      work: 3,
      project: 2,
      evaluation: 4,
      skills: 7,
      personal: 5,
    }))
      assert.equal(sec(kind).entries.length, n)
    const paper = root.locator('.paper-page')
    await expect(paper).toHaveCount(2)
    const firstIds = await paper
      .nth(1)
      .evaluate((el) =>
        ['side', 'main'].map((l) => el.querySelector('[data-lane="' + l + '"]').dataset.sourceId),
      )
    assert.deepEqual(firstIds, [sec('skills').id, sec('work').entries[2].id])
    const thisPage = await paper.first().boundingBox(),
      side = await paper.first().locator('.paper-side').boundingBox(),
      photo = await paper.first().locator('.paper-photo').boundingBox()
    assert.ok(Math.abs((side.x + side.width - thisPage.x) / thisPage.width - 0.34) < 0.01)
    assert.ok(Math.abs(photo.width / thisPage.width + 3 / 210 - 0.21) < 0.01)
    assert.equal(await paper.nth(1).locator('.paper-foot-curve').count(), 1)
    assert.equal(await paper.first().locator('.paper-foot-curve').count(), 0)
    console.log(
      'PASS A01/A02 populated independent entries, 2 naturally flowing pages, artwork and continuation anchors',
    )
    const pdfFile = path.join(dir, 'preview.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, pdfFile)
    await p.getByRole('button', { name: '导出 PDF', exact: true }).click()
    await expect(p.locator('.toast')).toContainText('已导出', { timeout: 30000 })
    const expected = await paper.evaluateAll((els) =>
      els.map((el) =>
        [...el.querySelectorAll('.paper-line')]
          .filter((l) => l.innerText.trim())
          .map((l) => ({
            side: l.dataset.lane === 'side',
            center: +l.dataset.y + parseFloat(l.style.height) / 2,
            text: l.textContent,
          })),
      ),
    )
    const xml = execFileSync('pdftotext', ['-bbox', pdfFile, '-'], { encoding: 'utf8' })
    const lineCount = verifyTextLines(xml, expected)
    await p.emulateMedia({ media: 'print' })
    let maxDrift = 0
    for (let i = 0; i < 2; i++) {
      const a = PNG.sync.read(await paper.nth(i).screenshot({ scale: 'css' }))
      const prefix = path.join(dir, 'raster')
      execFileSync('pdftoppm', [
        '-f',
        String(i + 1),
        '-l',
        String(i + 1),
        '-singlefile',
        '-scale-to-x',
        String(a.width),
        '-scale-to-y',
        String(a.height),
        '-png',
        pdfFile,
        prefix,
      ])
      const b = PNG.sync.read(await fs.readFile(prefix + '.png'))
      assert.equal(a.width, b.width)
      const regions =
        i === 0
          ? [
              [13, 22, 62, 71],
              [76, 11, 205, 24],
              [77, 24, 116, 31],
              [149, 24, 205, 30],
              [6, 72, 68, 83],
            ]
          : [
              [5, 10, 67, 22],
              [77, 10, 143, 18],
              [145, 9, 204, 17],
            ]
      for (const reg of regions) maxDrift = Math.max(maxDrift, matchRegion(a, b, reg))
    }
    await p.emulateMedia({ media: 'screen' })
    console.log(
      'PASS A12: ' +
        lineCount +
        ' matching PDF text lines; eight visual anchors, max drift ' +
        maxDrift.toFixed(2) +
        ' mm',
    )
    const btn = (n) => p.getByRole('button', { name: n, exact: true })
    const sectionToggle = (kind) => p.locator('[data-node-kind="' + kind + '"] > .re-rowhead > .re-toggle')
    await sectionToggle('target').click()
    const original = base.target
    const field = p.getByRole('textbox', { name: '目标岗位', exact: true })
    const samples = await field.evaluate(async (input, role) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const times = []
      for (let i = 0; i < 26; i++) {
        const want = role + i,
          t = performance.now()
        set.call(input, want)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(requestAnimationFrame)
        if (!document.querySelector('#print-root').textContent.includes(want))
          throw Error('Preview missed input')
        times.push(performance.now() - t)
      }
      return times.slice(1)
    }, original)
    const input95 = percentile95(samples)
    assert.ok(input95 <= 200, 'Input latency ' + input95 + ' ms')
    await field.fill(original)
    await btn('排版').click()
    const reflows = await p.evaluate(async () => {
      const times = []
      for (let i = 0; i < 26; i++) {
        const t = performance.now()
        document.querySelector('[aria-label="' + (i % 2 ? '减小正文字号' : '增大正文字号') + '"]').click()
        await new Promise(requestAnimationFrame)
        const text = document.querySelector(
          '#print-root .paper-line [style*="font-size: ' + (i % 2 ? '10pt' : '10.25pt') + '"]',
        )
        if (!text) throw Error('Preview did not publish new font size')
        times.push(performance.now() - t)
      }
      return times.slice(1)
    })
    const reflow95 = percentile95(reflows)
    assert.ok(reflow95 <= 500, 'Layout latency ' + reflow95 + ' ms')
    await btn('排版').click()
    console.log(
      'PASS A04 timed 25 warm React input-to-frame / global style-to-frame samples, P95 ' +
        input95.toFixed(1) +
        ' / ' +
        reflow95.toFixed(1) +
        ' ms',
    )
    await paper
      .first()
      .locator('[data-source-id="' + sec('work').entries[0].blocks[0].id + '"]')
      .first()
      .click()
    const edit = p
      .locator('[data-editor-id="' + sec('work').entries[0].blocks[0].id + '"] [contenteditable=true]')
      .first()
    await expect(edit).toBeVisible()
    const prev = await edit.innerText()
    const longText = '刻度验收 测试长条目 XYZ123'.repeat(850)
    await edit.fill(longText)
    await expect.poll(() => paper.count()).toBeGreaterThan(3)
    const spans = root.locator('[data-source-id="' + sec('work').entries[0].blocks[0].id + '"]')
    assert.ok(norm((await spans.allTextContents()).join('')).endsWith(norm(longText)))
    await edit.fill(prev)
    await expect(paper).toHaveCount(2)
    const project = sec('project').entries[0].id
    await paper
      .nth(1)
      .locator('[data-source-id="' + project + '"]')
      .first()
      .click()
    const row = p.locator('[data-editor-id="' + project + '"]')
    await row.locator(':scope > .re-rowhead button[aria-haspopup=menu]').click()
    await p.getByRole('menuitem', { name: '从这里另起一页' }).click()
    await expect(paper).toHaveCount(3)
    await row.getByRole('button', { name: '移除分页' }).first().click()
    await expect(paper).toHaveCount(2)
    console.log('PASS A07/A09 add and delete multi-page text, anchored manual break, no text loss')
    const work = sec('work'),
      job = work.entries[0]
    const blockRow = p.locator('[data-editor-id="' + job.blocks[0].id + '"]')
    await edit.focus()
    await edit.press('Meta+a')
    await blockRow.getByRole('button', { name: '添加链接' }).click()
    const address = 'https://example.org/local-resume-test'
    await blockRow.getByRole('textbox', { name: '链接地址' }).fill(address)
    await blockRow.getByRole('button', { name: '应用', exact: true }).click()
    await expect(root.locator('a[href="' + address + '"]').first()).toBeAttached()
    const linkedFile = path.join(dir, 'links.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, linkedFile)
    await btn('导出 PDF').click()
    await expect.poll(async () => Boolean(await fs.stat(linkedFile).catch(() => null))).toBe(true)
    assert.ok(execFileSync('pdfinfo', ['-url', linkedFile], { encoding: 'utf8' }).includes(address))
    await p.locator('[data-editor-id="' + work.id + '"] > .re-rowhead button[aria-haspopup=menu]').click()
    await p.getByRole('menuitem', { name: '移至简历左栏' }).click()
    const role = p.locator('[data-editor-id="' + job.id + '"] input[aria-label="职位"]')
    const text = 'PlatformInstrumentationCoordinator'.repeat(12)
    await role.fill(text)
    const lines = root.locator('[data-source-id="' + job.id + '"][data-lane=side]')
    await expect.poll(() => lines.count()).toBeGreaterThan(6)
    const geometry = await lines.evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect()
        return {
          text: row.textContent,
          pieces: [...row.querySelectorAll('span')].map((el) => {
            const b = el.getBoundingClientRect()
            return { left: b.left - box.left, right: box.right - b.right }
          }),
        }
      }),
    )
    assert.ok(
      geometry
        .map((r) => r.text)
        .join('')
        .includes(text),
    )
    for (const row of geometry)
      for (const piece of row.pieces)
        assert.ok(
          piece.left >= -0.5 && piece.right >= -1,
          'Narrow column text overflows ' +
            JSON.stringify({ left: piece.left, right: piece.right, lineLength: row.text.length }),
        )
    const dateLine = geometry.find((row) => row.text.includes('—'))
    assert.ok(
      dateLine && !dateLine.text.includes('Coordinator'),
      'Date must have its own line in the narrow column',
    )
    console.log(
      'PASS A09 narrow lane with long unbroken Latin title, dates and content inside boundaries; A12 active PDF link',
    )
  } finally {
    if (app) await app.close().catch(() => {})
    await fs.rm(dir, { recursive: true, force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
