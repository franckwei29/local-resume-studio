const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { Store, validate, mapImages } = require('./store.cjs')
const { atomicWrite, referencePath, readImport } = require('./files.cjs')

app.setName('简历工坊')
if (process.env.RESUME_STUDIO_HOME) app.setPath('userData', path.resolve(process.env.RESUME_STUDIO_HOME))
app.commandLine.appendSwitch('disable-background-networking')
let win, store, importAbort
let closeAllowed = false
let rendererReady = false
let exporting = false
const outputs = new Set()
const userDir = app.getPath('userData')
const safeName = (name) => name.replace(/[/\\:\u0000-\u001f]/g, '_').trim() || '简历'

async function chooseOpen(title, extensions) {
  const result = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: [{ name: title, extensions }],
  })
  return result.canceled ? null : result.filePaths[0]
}
async function chooseSave(title, file, ext) {
  const result = await dialog.showSaveDialog(win, {
    title,
    defaultPath: file,
    filters: [{ name: title, extensions: [ext] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  return result.canceled ? null : result.filePath
}
function setupIPC() {
  const bind = (name, fn) =>
    ipcMain.handle('studio:' + name, (e, ...args) => {
      if (!win || e.sender !== win.webContents || e.senderFrame !== e.sender.mainFrame)
        throw new Error('只能在本机应用中使用此操作。')
      return fn(...args)
    })
  bind('initialize', (data) => {
    const initial = store.initialize(data)
    rendererReady = true
    return initial
  })
  bind('personalSeed', () => store.privateSeed())
  bind('list', () => store.list())
  bind('save', (doc, expected) => store.save(doc, expected))
  bind('remove', (id) => store.remove(id))
  bind('backup', async (doc) => {
    validate(doc)
    const dest = await chooseSave('导出可编辑备份', safeName(doc.name) + '.resume.json', 'json')
    if (!dest) return null
    await atomicWrite(dest, JSON.stringify(doc, null, 2), await referencePath(userDir))
    return dest
  })
  bind('restore', async () => {
    const file = await chooseOpen('导入可编辑备份', ['json'])
    if (!file) return null
    let raw
    try {
      raw = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      throw new Error('无法读取备份文件，请选择完整的 .resume.json 文件。')
    }
    mapImages(validate(raw), (src) => {
      if (nativeImage.createFromDataURL(src).isEmpty())
        throw new Error('备份中的图片无法解码，请选择完整的可编辑备份。')
      return src
    })
    return store.restore(raw)
  })
  bind('exportPDF', async (id, name, revision) => {
    if (exporting) throw new Error('正在生成 PDF，请稍候。')
    const doc = store.get(id)
    if (!doc || doc.revision !== revision) throw new Error('简历版本已更新，请重新导出。')
    exporting = true
    try {
      const contents = win.webContents
      const expectedStyle = JSON.stringify(Object.entries(doc.style).sort())
      const signature = JSON.stringify([
        doc.id,
        doc.templateId || '00',
        String(doc.templateVersion ?? 1),
        expectedStyle,
        String(revision),
      ])
      await contents.executeJavaScript(`(async()=>{
        const root=document.getElementById('print-root');
        if(!root) throw new Error('请打开需要导出的简历预览。');
        const deadline=performance.now()+20000;
        const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
        while(true) {
          const paper=root.querySelector('.paper-document');
          const signature=JSON.stringify([root.dataset.printDocument, paper?.dataset.templateId, root.dataset.templateVersion, root.dataset.printStyle, paper?.dataset.revision]);
          if(paper?.dataset.layoutReady==='true' && signature===${JSON.stringify(signature)} && paper.querySelector('.paper-page')) break;
          if(performance.now()>deadline) throw new Error('当前版本排版尚未完成，请重试。');
          await frame();
        }
        await document.fonts.ready;
        if(Array.from(document.fonts).some(f=>f.status==='error')) throw new Error('本机字体加载失败。');
        await Promise.all(Array.from(root.querySelectorAll('img')).map(img=>img.decode()));
      })()`)
      const pdf = await contents.printToPDF({
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      const dest = await chooseSave('保存 PDF', safeName(name) + '.pdf', 'pdf')
      if (!dest) return null
      await atomicWrite(dest, pdf, await referencePath(userDir))
      outputs.add(dest)
      store.recordExport(id, revision)
      return dest
    } finally {
      exporting = false
    }
  })
  bind('openOutput', async (file) => {
    if (!outputs.has(file)) throw new Error('请先导出文件。')
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  })
  bind('revealOutput', (file) => {
    if (outputs.has(file)) shell.showItemInFolder(file)
  })
  bind('importFile', async () => {
    if (importAbort) throw new Error('已有文档正在读取。')
    const controller = new AbortController()
    importAbort = controller
    try {
      const file = await chooseOpen('导入本地简历', ['pdf', 'docx'])
      if (!file || controller.signal.aborted) return null
      const binary = app.isPackaged
        ? path.join(process.resourcesPath, 'resume-import')
        : path.join(__dirname, '../native/bin/resume-import')
      return await readImport(
        binary,
        file,
        (p) => win?.webContents.send('studio:importProgress', p),
        controller.signal,
      )
    } finally {
      importAbort = null
    }
  })
  bind('cancelImport', () => importAbort?.abort())
  bind('closeReady', () => {
    closeAllowed = true
    win?.close()
  })
}

function createWindow() {
  closeAllowed = false
  rendererReady = false
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#f7f8f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.on('close', (event) => {
    if (!closeAllowed && rendererReady && !win.webContents.isDestroyed()) {
      event.preventDefault()
      win.webContents.send('studio:beforeClose')
    }
  })
  win.on('closed', () => {
    importAbort?.abort()
    win = null
  })
  win.loadFile(path.join(__dirname, '../dist/index.html'))
}
function startup() {
  store = new Store(userDir)
  setupIPC()
  // All assets, fonts, imports and exports are local, including packaged first-run.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  )
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  )
  createWindow()
}
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app
    .whenReady()
    .then(startup)
    .catch((err) => {
      dialog.showErrorBox('无法启动简历工坊', err.message)
      app.exit(1)
    })
  app.on('activate', () => {
    if (app.isReady() && !win && store) createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => store?.close())
} else {
  app.quit()
}
