import { blank, block, entry, section } from './model'
import type { Block, Entry, Kind, Lane, Resume } from './model'
import avatar from './assets/demo-avatar.png?inline'

function paragraph(text: string, label = '') {
  return block(label ? 'label' : 'paragraph', text, label)
}
function bullets(heading: string, items: string[], ordered = false) {
  const group = block('group', heading)
  group.children = items.map(text => block(ordered ? 'number' : 'bullet', text))
  return group
}
function record(fields: Record<string, string>, start='', end='', blocks: Block[]=[]): Entry {
  return { ...entry(fields), start, end, current: end === 'present', blocks, ...(end === 'present' ? { end: '' } : {}) }
}
function moduleOf(kind:Kind, lane:Lane, entries:Entry[]) {
  return {...section(kind,lane), entries}
}

/** Entirely fictional data distributed with the public application. */
export function publicSeed(): Resume {
  const doc = blank('产品设计师 · 示例简历')
  doc.target = '高级产品设计师'
  doc.photo = { src:avatar, x:.5, y:.5, zoom:1, rotation:0 }
  const personal = moduleOf('personal','side',[
    ['姓名','林宁','name'],['邮箱','lin.ning@example.com','email'],['电话','010-0000-0000','phone'],
    ['所在地','中国杭州','location'],['生日','1996-05-20','birthday']
  ].map(([label,value,icon]) => entry({label,value,icon})))
  const evaluation = moduleOf('evaluation','side',[
    '具备产品设计、信息架构与服务设计背景，善于把抽象需求转化为可以验证的用户流程，能够独立完成调研、原型、交互规格和上线复盘。',
    '长期参与公共交通与社区出行产品，在开放数据和无障碍辅助工具的实践中，关注不同使用能力、网络条件和设备环境下的体验。',
    '具有跨团队项目推进经验，习惯用系统化标注与工程团队协作，明确边界条件、关键状态与验收标准。通过工作坊让一线运营、客服与研发共同参与方案决策。',
    '拥有中英文工作坊主持与方案汇报经验，能够编写设计规范、用户研究报告及对外交流材料。'
  ].map(text=>entry({text})))
  const skills = moduleOf('skills','side',[
    ['体验研究','能够规划研究样本、设计任务脚本并主持可用性访谈，结合观察记录和业务指标，持续跟踪设计改进带来的实际效果。'],
    ['交互设计','熟悉复杂流程的信息架构与状态拆解，通过低保真草图、高保真交互原型与组件规范推动可验证的设计决策。'],
    ['服务设计','具备旅程地图和服务蓝图绘制经验，能识别线下接触点与线上信息之间的断层。'],
    ['视觉系统','掌握栅格、字体、色彩和图标设计，能根据平台特点维护一致的设计语言。'],
    ['数据分析','熟悉 SQL、电子表格及指标看板，能够结合用户反馈解释关键路径中的流失原因。'],
    ['原型开发','熟悉 TypeScript、React 和 CSS，能实现离线原型与键盘交互演示。'],
    ['团队协作','熟悉版本管理、迭代评审、上线清单和文档归档，善于协调产品、研发与运营。']
  ].map(([name,description])=>entry({name,description})))
  const edu = moduleOf('education','main',[
    record({major:'交互设计',degree:'硕士',school:'远岸设计学院',note:'人机交互方向'},'2018-09','2020-06'),
    record({major:'工业设计',degree:'本科',school:'春城理工学院',note:'产品设计方向'},'2014-09','2018-06')
  ])
  edu.ending=[paragraph('设计研究方法、信息可视化、人因工程、交互系统、服务设计、产品策略与原型开发。','核心课程')]
  const work = moduleOf('work','main',[
    record({role:'资深产品设计师',company:'行舟设计工作室'},'2023-02','present',[
      paragraph('负责出行服务产品从用户研究到方案交付的完整流程，协调城市运营、工程和客服团队共同定义问题，建立可验证的改版目标。围绕移动端、调度台与站点标识三个接触点，持续梳理跨渠道的一致体验。','工作概述'),
      bullets('多模式路线规划',[
        '组织日常通勤者与低视力用户进行任务研究，记录从出发地查询到站内换乘的关键判断点。将模糊的推荐标签拆解为步行距离、站点设施、换乘次数和可达性提示。',
        '与地图和客户端共同制定信息优先级及异常降级方案。在弱网、临时改线与线路停运等场景下保留可理解的替代路线和下一步指引。']),
      bullets('运营工作台',[
        '把分散的站点告警、工单与路线变更集中为可追踪的事件视图，梳理分派、确认、处理和复核流程，形成覆盖日常运营的角色权限矩阵。',
        '为值班人员组织原型走查，记录复杂告警合并时的误操作原因，优化批量处理的确认反馈，并补齐操作日志、恢复和失败重试的界面规范。']),
      bullets('无障碍设计规范',[
        '针对放大字号、屏幕阅读器与键盘导航建立走查清单。参与设计组件的对比度、焦点顺序和可触达区域测试，将发现的问题整理为有优先级的修复任务。对重点路线建立可重复的体验任务，按场景记录障碍、恢复成本和所需的支持信息，随后用对照走查确认修订生效。',
        '与客服一起复盘上线后的反馈，撰写迁移手册与示例交互，组织产品和研发团队演练异常情况并完成阶段验收。'])
    ]),
    record({role:'服务设计师',company:'青屿体验研究院'},'2020-07','2023-01',[
      paragraph('围绕社区公共设施与出行服务开展多场景研究，连接街区访谈、实地观察与后台使用数据，协助业务团队明确服务机会与试点目标。','工作概述'),
      bullets('',[
        '负责调研招募、访谈提纲和资料分析，开展多次街区随行观察。结合居民反馈，建立不同时间段、不同设备和不同出行需求的旅程地图。',
        '参与线下指引与线上预约协同设计，制作可复用的标识原型，跟进现场布点、可读性测试和信息更新流程；在试点活动后输出可执行的改进清单。',
        '与工程团队共同建立轻量数据看板，把咨询量、任务完成时间与现场反馈结合分析，形成周度复盘机制并将研究结论交接给后续负责团队。',
        '为不同街区建立统一的设施资料模板，记录入口方向、坡道情况、开放时段和现场联系人。在信息来源存在冲突时组织现场复核，再把修订原因反馈给社区运营人员。',
        '整理业务培训材料，带领一线志愿者完成从查找站点、提交修订到确认发布的全过程，帮助团队识别最容易遗漏的流程步骤。'])
    ]),
    record({role:'设计实习生',company:'拾光公共设计中心',subtitle:'社区导览与信息无障碍'},'2019-06','2019-12',[
      paragraph('为社区文化空间设计导览信息架构，开展场地梳理与用户访谈，协助验证不同导览媒介的可用性。','项目简介'),
      paragraph('Figma、地图原型、用户访谈、现场测试与数据记录。','工作工具'),
      paragraph('绘制访客和场馆运营人员的使用路径，整理图标素材和双语文本。为志愿者准备布点说明，并跟踪试运行例会中的问题统计。','主要工作')
    ])
  ])
  work.intro=[paragraph('面向出行服务、社区运营与公共信息产品开展交互设计。曾在研究、设计与工程协作岗位中积累全流程经验，参与从需求发现、体验原型到服务上线的各个阶段，持续关注信息复杂、使用频繁且需要线下协作的场景。')]
  const projects=moduleOf('project','main',[
    record({name:'潮汐城市出行导航',note:'独立设计',source:'公共服务产品设计项目'},'2024-03','2024-10',[
      paragraph('为城市访客和日常乘客整合多模式出行信息，在网络波动及临时改线时提供可解释的替代路线。','项目简介'),
      paragraph('Figma、TypeScript、React、开放地图数据、可用性访谈。','工具与方法'),
      bullets('核心工作',['梳理首次出行和重复通勤两类目标，建立路线比较、临时变更和到站确认的统一信息结构。','围绕站内换乘、步行到站和无障碍通道三个场景制作可交互原型，记录常见误解与信息缺口。','将空间路径与班次时间拆分为可复用组件，为异常状态制定提示语、替代动作与键盘操作。','建立设计评审清单，复盘用户反馈和演示数据，整理下一轮试点计划。'])
    ]),
    record({name:'Neighborhood Atlas',source:'社区设施信息整理与协作工具'},'2025-01','present',[
      paragraph('整合社区设施的开放时间、出入口与无障碍信息，为社区志愿者提供可信的协作编辑流程。','项目简介'),
      paragraph('React、SQLite、地图瓦片、离线资料采集与图标系统。','工具与方法'),
      bullets('项目职责',['实地观察社区资料更新流程，梳理重复录入和来源不明的问题，确定资料更新所需的最小字段。','设计现场记录、冲突核对和发布预览流程，验证多个志愿者协作时的记录完整性。','跟踪测试反馈，更新社区协作手册和离线访问说明，为下个试点保留可复用的研究材料。'],true)
    ])
  ])
  doc.sections=[personal,section('target','side'),evaluation,skills,edu,work,projects]
  return doc
}
