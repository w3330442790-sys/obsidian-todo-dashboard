# Compact Homepage Implementation Plan

**Goal:** 默认首页在常见桌面宽度呈现紧凑的两行三栏卡片，保留功能、草稿与旧布局恢复。

**Architecture:** 在 dashboard 提供紧凑预设/迁移/恢复辅助函数；新增 home-summary 模块呈现首页复盘与助手摘要，原完整页面不变。追加紧凑专用 CSS，不缩小整页比例。共享设置只增预设版本与旧配置备份。

**Tech Stack:** CommonJS、Obsidian Vault API、CSS Grid/container queries、Node tests、Playwright。

- [x] tests/dashboard.test.cjs 先验证 5/4/3 两行、短统计和助手条的高度、迁移幂等、旧布局/风景偏好恢复和保存后可调尺寸。
- [x] dashboard.cjs 新增 compactLayout/migrateCompact/restore helpers，normalizeLayout 支持每模块不同最小高度，默认桌面 5/4/3、平板 6/6、短条 12；现有拖拽保持。
- [x] 插件初始化后仅迁移一次并保存原 dashboard/gallery，提供应用紧凑布局与恢复旧布局方法，写入保留设置快照冲突检查。
- [x] home-summary.cjs 渲染回顾摘要/打开完整复盘、助手状态/打开聊天/整理课程；不在首页生成长表单，不丢已有 journal/assistant 状态。
- [x] views.cjs 首页采用 compact 类、紧凑问候与收拢布局工具；灵感短输入、待办和最近笔记内部滚动；进入完整页面后保留原功能。
- [x] styles-compact.css 统一边距/标题/圆角，风景 120px，统计短条，常规卡 208–220px，助手短条，桌面三栏/中屏两栏/窄屏一栏，深色与编辑模式可用。
- [x] tests/ui-test 更新原流程的展开入口，添加默认桌面高度、行列对齐、5行笔记、内部滚动、旧布局恢复、草稿跨页面保留、完整复盘/聊天和窄屏测试。保留原回归。
- [x] 独立代码审查并修复，运行 npm test/build/UI，截图目视检查；不声称已完成真实安卓/EasySync 验收。
- [ ] 版本递增 0.3.1，更新文档、备份安装电脑程序文件、提交推送并发布 Release，回读核心附件哈希、更新维护交接。

验证：93 项自动测试、34 项隔离浏览器流程通过，1440px 桌面主体底部 855px，默认平板两栏截图已目视检查。独立审查发现的备份刷新问题已回归修复。
