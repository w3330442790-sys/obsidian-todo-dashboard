# Dashboard v3 and Course Notes Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement independent modules, then review integration and verification.

**Goal:** 将已确认的首页改版、专注累计、灵感复盘与课程录音持续整理实现为兼容旧数据的新 BRAT 版本。

**Architecture:** 保留 core/store 的任务和专注记录，新增 journal 文件存储、course 服务、Windows 讯飞 CLI bridge 与独立 Codex 只读生成作业。布局、内容、外部读取模块互不依赖，通过插件入口集成。AI 只生成草稿，写入经界面确认和文件快照检查。

**Tech Stack:** CommonJS、Obsidian Vault API、Pointer Events、Node test runner、官方 Codex app-server stdio、本机讯飞听见 CLI。

## 1. 布局（独立任务）
- [x] 先测试 1–12 列归一化、末尾插入和向后移动、旧布局兼容。
- [x] src/dashboard.cjs 扩展 inspiration/reflection 稳定模块 ID，focus 默认 4 列；拖动标题、浮层、插入线、空隙与末尾落点、边缘滚动、Esc 取消、缩放吸附和尺寸指示。
- [x] 专属样式 styles-layout.css，所有取消/关闭路径清理事件与交互锁。保留设备独立尺寸和设置快照冲突检查。
- [x] node --test tests/dashboard.test.cjs；UI 测试验证实际指针与重开持久化。

## 2. 灵感/复盘文件（独立任务）
- [x] 新增 src/journal.cjs 与 tests/journal.test.cjs：先验证新增记录、多端加载、正文人工编辑、旧快照拒绝写入、非法 ID、损坏记录保留。
- [x] JournalStore(vault,root,ensureFolder) 提供 load(), inspirations/reflections Maps, token(kind,id), saveInspiration(record,expected), saveReflection(record,expected)。每条普通 md，文本正文为权威文本；灵感在 灵感/，复盘在 复盘/。
- [x] 记录 {id,text,type,createdAt,updatedAt}；复盘另含 startDate/endDate。日期范围统计由 src/reflection.cjs 汇总任务、专注、灵感和笔记元数据，不默认注入整库正文。

## 3. 课程与讯飞（独立任务）
- [x] 新增 src/course.cjs、src/xftj-bridge.cjs、src/course-view.cjs 及测试。Bridge Windows 才加载 Node，调用已安装官方流程 CLI（可配置路径）validate/list/detail/download，不打印凭据、签名 URL 或原文。
- [x] 每条实际 fileSource 分流，LOCKED 跳过；只读已有稿，不发起收费任务。录音列表点击整理先选择课程。
- [x] CourseService 的文件接口与生成接口依赖注入：每课稳定 ID，课程总笔记/重点与考点/原始资料/整理记录，原始录音 ID 与哈希去重；先草稿，展示两篇文本确认后保存，历史备份及原始快照冲突检查。
- [x] 习题导入 PDF/DOCX/TXT/MD/图像，保存原文件和来源；Codex 工具提取或图片输入，对无法读取的材料报告失败，不假装完整读取；生成引用源路径、页码/题号。
- [x] 更新重点保留已有人工内容，差异草稿确认才覆盖；需核对的转写与答案冲突显式标注。

## 4. 主集成（主任务）
- [x] 测试专注统计 pause/resume、当前+历史、保存过渡去重、跨日与总量。
- [x] src/reflection.cjs 计算 focusTotals(sessions,timer,now)，默认专注卡整合今日/周/总量；从概览移除重复专注指标。
- [x] views 顶部四/五个主导航，待办列表/月历/四象限/时间轴切换，共享筛选，回收站及分类管理收拢；兼容旧命令。
- [x] 集成灵感输入和列表、复盘范围/手写/生成草稿/保存，输入值不因文件事件刷新丢失。
- [x] src/assistant.cjs 提供互斥只读 generateJob(prompt,{images,signal})，自有线程不污染用户对话；原生审批继续拒绝写入；停止需等终止。
- [x] 生命周期初始化与 reload 加载新增内容，渲染不得覆盖草稿，兼容 Android 无 Node 路径。

## 5. 验证与交付
- [x] 单元测试、build、隔离 Edge UI，新增导航、灵感、复盘草稿、计时总量、拖动末尾/空隙/Esc、课程选择/未解锁/去重/草稿确认/冲突测试。
- [x] 独立规格审查与代码审查，修复后再验证。实际讯飞仅读取已授权账户，原文不入 Git。
- [x] 更新 0.3.0 文档、维护交接与发布附件。发布前检查 git diff，不上传密钥、课程原文、习题和实际截图。
- [ ] 安装电脑程序文件；若原生 UI 无法安全重载，明确说明需要重新启用。发布 GitHub Release 后匿名回读核心附件并核对哈希，BRAT 地址保持不变。

验证快照：84 项单测、30 项隔离浏览器交互通过；真实讯飞只读转写、隔离 Codex 结构化草稿及 PDF/图像读取通过。独立规格审查与代码审查的问题已修复并复核。原生 Obsidian 最终重载、安卓与 EasySync 双端尚待实机验收。

交付状态：电脑程序三文件已安装并核对哈希；Release 附件上传和公开哈希回读进行中。最终原生重载未强制执行，避免中断当前编辑；需要用户重新启用插件。
