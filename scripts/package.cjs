const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { execFileSync } = require('node:child_process')
const { packager } = require('@electron/packager')
async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-package-'))
  try {
    for (const dir of ['electron', 'dist']) fs.cpSync(dir, path.join(temp, dir), { recursive: true })
    const meta = require('../package.json')
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({
        name: meta.name,
        productName: meta.productName,
        version: meta.version,
        main: meta.main,
      }),
    )
    const licenseDir = path.join(temp, 'licenses')
    fs.mkdirSync(licenseDir)
    for (const dep of ['react', 'react-dom', 'lucide-react'])
      fs.copyFileSync(
        require.resolve(dep + '/package.json').replace(/package\.json$/, 'LICENSE'),
        path.join(licenseDir, dep + '.txt'),
      )
    fs.copyFileSync('node_modules/electron/dist/LICENSE', path.join(licenseDir, 'electron.txt'))
    fs.copyFileSync(
      'node_modules/electron/dist/LICENSES.chromium.html',
      path.join(licenseDir, 'chromium.html'),
    )
    const options = {
      dir: temp,
      out: path.resolve('release'),
      name: meta.productName,
      platform: 'darwin',
      arch: 'arm64',
      appBundleId: 'studio.localresume.desktop',
      electronVersion: require('electron/package.json').version,
      overwrite: true,
      prune: false,
      asar: true,
      extraResource: [path.resolve('native/bin/resume-import')],
    }
    if (fs.existsSync('assets/Studio.icns')) options.icon = path.resolve('assets/Studio.icns')
    const [folder] = await packager(options)
    const app = path.join(folder, meta.productName + '.app')
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
    execFileSync('ditto', [
      '-c',
      '-k',
      '--keepParent',
      app,
      path.resolve('release/Local-Resume-Studio-macOS-arm64.zip'),
    ])
    console.log(app)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
