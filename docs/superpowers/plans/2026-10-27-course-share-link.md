# Course share-link import implementation plan

User-approved flow: paste a 讯飞听见 share link → read preview → confirm course → generate existing two-note draft → review and save.

- [x] Add share-reader.cjs with strict https/host/path/audioId validation and the share page observed read-only GET /ShareAudioService/v1/audioShares/<shareId>. Parse original transcript only, reject revoked/empty/unknown results, limit size, support abort. No account key or paid tasks.
- [x] Add tests first for unsafe URLs, metadata/raw transcript, revoked or summary-only result, abort; canonicalize URL and retain source ID/path without signed audio URL.
- [x] CourseService.prepareShare reuses source import and generation workflow, duplicates rejected by share ID and underlying recording ID. Preview stays memory-only until course confirmation; no model call before confirmation.
- [x] Add URL field/read-preview in course-view, preview title/duration/text, course confirmation and existing rerun option. Windows execution first; Android can preview public link if requestUrl supports but Codex generation remains Windows.
- [x] Node tests and isolated UI with synthetic share fixtures; actual user share read-only smoke outside Git; independent review.
- [ ] Version 0.3.2 install/Release and public hash verification. Do not commit actual share ID, signed audio URL, cookies or transcript.

开发验证：103 项单测、36 项隔离界面检查通过；实际分享仅读取验证，未生成真实课程笔记。独立审查未发现 P1/P2。安装、发布及公开附件校验结果以维护交接和 Release 为准。
