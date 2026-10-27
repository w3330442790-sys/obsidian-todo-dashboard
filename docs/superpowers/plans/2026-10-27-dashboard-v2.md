# Dashboard v2 Implementation Plan

**Goal:** 风景图库、5 条可见的最近笔记、可编辑布局与 Windows Codex 面板，保留旧数据，发布 BRAT 更新。

**Architecture:** 新增 dashboard 模块管理图片选取和布局配置，新增 Codex JSON-RPC 客户端与助手视图模块。现有任务领域层保持不变。图库作为单独 ZIP 发布和导入，不嵌入 JS。

**Tech Stack:** CommonJS JavaScript、Obsidian Vault API、Pointer Events、Codex App Server stdio、Node test runner。

## 首页与布局
- [x] 在 `tests/dashboard.test.cjs` 写失败测试：同日图片稳定、次日轮换、未知模块补齐、尺寸边界、上移/下移持久化。
- [x] 实现 `src/dashboard.cjs` 的规范化、选图、重排和渲染容器辅助函数；更新 `src/views.cjs` 为稳定 ID 模块网格。
- [x] 编辑模式实现 pointer 拖动重排、缩放及键盘/触控替代；设置中保留独立桌面/平板尺寸。
- [x] 最近笔记取 50 条、首屏 5 条高度、内部滚动；标题固定。
- [x] 风景设置包含隐藏、高度、库内自选图片和图库导入；URL 仅使用库内 resource path。

## 独立 Codex 模块
- [x] `tests/codex-client.test.cjs` 先验证分包、请求失败、超时、审批、取消和关闭。
- [x] `src/codex-client.cjs` 使用官方 stdio 协议；子进程路径只接受可执行文件路径，不拼 shell 命令。初始化后查询账号及模型，线程 cwd 为库目录。
- [x] `src/assistant.cjs` 显示聊天、连接/登录、流式文本、停止、历史恢复和审批 UI；安卓明确不可本机执行。
- [x] 默认只读线程，切换写入模式创建独立线程；未知审批默认拒绝，退出时取消 pending 与自己启动的进程。

## 照片收集
- [x] 仅收集许可可追溯的真实风景图，保存许可、来源与作者；生成图库 ZIP。
- [x] 下载后视觉检查，并导入用户指定/现用笔记库的风景目录；文件写入需遵守目录权限。

## 集成与交付
- [x] 更新插件入口、构建脚本、可选设置校验及隔离测试夹具。
- [x] `npm test`、`npm run build`、隔离浏览器布局/滚动/图片/助手状态测试。
- [x] 使用本机 CLI 验证握手、账号与模型列表；实际模型请求仅针对隔离测试库。
- [x] 独立审查修复；完成发布产物。最终原生 Obsidian 重载未执行，避免中断用户当前编辑。发布状态见交接与公开 Release。
- [x] 回读公开附件校验哈希，更新维护交接文档与进度。
