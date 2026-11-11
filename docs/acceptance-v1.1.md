# 简历工坊 v1.1.0 · Mac 桌面验收

在 Apple M4（Mac16,13）、macOS 27.0.1 arm64 上，以发行 ZIP 内同一构建的 Electron 应用执行。模板卡片使用虚构资料，右侧候选预览使用打开的文档。公开测试使用临时 SQLite，个人用例从本机起稿建立隔离副本。

| 用例 | 在实际产品中检查的结果 | 复现入口 |
|---|---|---|
| T01 库与结构 | 31 个唯一 ID。忽略名称、颜色、来源 ID 后，30 款新增纸张的文字位置、几何装饰和区域结构各异。栏型数量单栏 20、左侧栏 6、右侧栏 5，带照 5。 | templates、template-layout、template-acceptance |
| T02 筛选／键盘 | 组合筛选、结构关键词、空结果、清空、卡片方向键、回车试排、Esc 取消、返回触发按钮焦点。 | template-acceptance、template-navigation |
| T03 候选隔离 | 保留未落库的最后输入。实际延迟旧候选的字体完成回调，切到新款再取消，数据库与撤销记录保持原状态。普通后台保存回包不会重置正在看的候选页。 | template-acceptance、template-recovery、template-navigation |
| T04 多页对比 | 同一份试样由两页变为三页；按同一内容 ID 对齐，独立查看候选末页，窄窗保留所选页。 | template-acceptance |
| T05 应用与撤销 | 应用、输入、两次撤销和两次重做。模板、位置、正文与历史动作一一对应。 | template-acceptance |
| T06 排序 | 用指针在单栏拖动模块，切到右辅栏再切回。另检验自定义模块、隐藏、新增与删除的往返顺序。 | template-acceptance、templates |
| T07 任意两款 | 31 × 30 共 930 组有向切换及切回，逐字段比较嵌套正文、ID、照片取景、链接、手动分页和各款样式。 | templates |
| T08 特殊结构 | E1–E5 各处理缺项、隐藏、长内容、引言和显式分页。核对 F2 九章目录的第六格去向、F3 项目编号、A4 的空字段以及 E3 在编辑器中标记的前置记录。 | template-layout、template-navigation |
| T09 照片与定位 | 仅有照片的稿件切无照款，导出给出明确提示；B4 恢复旋转与取景。长联络行可从纸面点击定位到对应字段。 | templates、template-recovery |
| T10 预览与 PDF | 每款从编辑器导出长样本，逐页验证 A4、页数及完整字符、外链、目录内部目的页与位置。逐页栅格和关键文本锚点对比，另在 E4 扩写到新增页后删回并比较原有每页正文。 | template-pdf |
| T11 旧稿与备份 | v1 数据库事务升级、旧备份恢复、未用模板回看；原生备份对话框完成导出／导入，复制时重映射栏目 ID，重启后各稿仍独立。 | templates、template-recovery |
| T12 故障恢复 | 强制候选字体失败，重试成功；在临时 SQLite 引入真实写入错误，保持磁盘旧档，继续输入再重试。立即导出的 PDF 含最新内容。 | template-recovery、template-acceptance |
| T13 离线与时延 | 打包应用禁网后测量输入、全局字号和模板试排。样本量与 P95 见下表。 | performance、template-acceptance |
| T14 管理入口 | 从基准和空白创建、取消新建、导入 DOCX／两类 PDF、复制、恢复备份及重启，核对模板名、缩略图、实际页数和独立数据。 | acceptance、import-acceptance、template-acceptance、template-recovery |
| T15 原版回归 | 公开示例和个人原稿分别运行 A01–A16；原稿仍自然排成两页，第二页从技能及第三段工作开始。个人稿在同一份临时数据库内试排全部 31 款，比较、应用、撤销后核对原有正文与裁剪。 | accept-release、private-template-acceptance |

## 复现

需要 Apple Silicon Mac、Node 24、Xcode Command Line Tools 和 Poppler。一次完整运行会使用多个临时目录。公开包和公开用例不需要个人文件。

```sh
npm ci
npm test
npm run format:check
npm run package
npm run test:release
```

将环境变量 `RESUME_TEST_SEED` 指向本机的结构化起稿后运行 `node scripts/accept-release.cjs --private`，可复验个人基准。如另设 `RESUME_REFERENCE_PDF`，程序会在流程前后比较原 PDF 的 SHA-256。公开仓库未收录个人起稿及测试文件。文件选择对话框在测试中注入路径，字体测量、Electron 打印、SQLite、文件读写及系统 OCR 均使用生产代码。

## 实测数据与安装

2026-11-11，在同一台 Mac 上运行最终应用包。22 个逻辑、存储、导入和几何测试全部通过。桌面用例从应用正常入口运行，未设置跳过项。

| 样本与动作 | 采样 | 实测 P95 | 阈值 |
|---|---:|---:|---:|
| 虚构两页稿，字段输入到屏幕更新 | 51 次 | 30.2 ms | 200 ms |
| 虚构两页稿，全局字号到完成重排 | 51 次 | 31.4 ms | 500 ms |
| 本机个人两页稿，字段输入到屏幕更新 | 51 次 | 30.1 ms | 200 ms |
| 本机个人两页稿，全局字号到完成重排 | 51 次 | 31.5 ms | 500 ms |
| 虚构两页稿，选款到候选页面与页数就绪 | 50 次 | 34.2 ms | 800 ms |

**打印一致性。** 31 份长样本 PDF 各有 3 页，共 93 页。每一页的中英文字符按阅读顺序核对，统一 Unicode 形式并去除布局空白后逐字相同。将 PDF 栅格与编辑器屏幕中 100% 的纸张截图比较，279 个文字锚点的最大几何偏差为 0.591 mm，低于 1 mm 阈值。最小归一化亮度相关系数为 0.927，按 8 × 8 像素网格统计的整页 RGB 色密度平均差，最大为 5.075/255。F2 目录的实际 PDF 内部跳转逐项核过目标页与链接位置。另在 00 的两页基准中，公开示例 129 行和个人样本 166 行均匹配，8 个原版锚点的最大偏差为 0.26 mm。

**双击与故障路径。** 在同一帧对「应用此模板」送出两次激活，随后改字、连续撤销和重做，只有一次模板切换进入历史。磁盘写入故障、字体未返回、候选排版失败均执行了实际恢复路径。

**本机安装。** 安装前用 SQLite 在线备份保留旧数据库。校验签名后以原子替换更新 .app，从用户 Applications 目录断网启动 1.1.0，打开已存在的个人副本，检查两页原稿、31 款入口、真实内容对比和取消。升级前后逐份比较全部现有记录、回收站状态和图片字节。个人参考 PDF 原文件哈希一致。公开分发的应用资源与受测构建一致，包内为虚构示例和离线字体。

分发包 `Local-Resume-Studio-macOS-arm64.zip` 为 121,800,448 字节，SHA-256 为 `19d1ff34042dd7af8ff75f7266333ecce0a6302ca519c952ea60dc6cded22022`。应用通过 `codesign --verify --deep --strict`，ZIP 通过完整性检查。使用本机 ad-hoc 签名，未经 Apple Developer ID 公证。
