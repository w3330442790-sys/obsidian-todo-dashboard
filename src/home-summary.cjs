'use strict';
const C=require('./core.cjs'),R=require('./reflection.cjs');

function renderReflectionSummary(view,parent,ui){
 const{el,button,panel}=ui,p=view.plugin,s=view.state.journal||{},box=panel(parent,'回顾复盘');
 box.classList.add('td-home-reflection');
 const today=C.localDate(),tasks=[...(p.store?.tasks?.values()||[])],sessions=[...(p.store?.sessions?.values()||[])];
 const completed=tasks.filter(t=>!t.deleted&&t.status==='done'&&t.completedAt===today).length;
 const focus=R.focusTotals(sessions,p.timer).today;
 const inspirations=[...(p.journal?.inspirations?.values()||[])].filter(i=>C.localDate(new Date(i.createdAt))===today).length;
 el(box,'p','td-home-reflection-facts',`完成 ${completed} 项 · 专注 ${C.duration(focus)} · 灵感 ${inspirations} 条`);
 const latest=[...(p.journal?.reflections?.values()||[])].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0];
 if(latest){
  el(box,'small','td-muted','最近复盘'+(latest.startDate?' · '+latest.startDate:''));
  const text=Array.from(String(latest.text||'').replace(/\s+/g,' ').trim());
  el(box,'p','td-home-reflection-excerpt',text.length>90?text.slice(0,89).join('')+'…':text.join('')||'这条复盘还没有正文。');
 }else el(box,'p','td-home-reflection-excerpt td-muted','记录今天的收获、遇到的问题和下一步。');
 if(s.busy)el(box,'p','td-muted','正在生成复盘草稿…');
 else if(s.saving)el(box,'p','td-muted','正在保存复盘…');
 else if(s.text?.trim())el(box,'p','td-muted',s.id?'可继续编辑当前复盘。':'已有复盘草稿，可继续编辑。');
 function openReflection(){
  view.go('journal');
  const input=view.contentEl?.querySelector?.('.td-review-text');
  input?.scrollIntoView?.({block:'center',behavior:'smooth'});
  input?.focus?.({preventScroll:true});
 }
 const actions=el(box,'div','td-journal-actions');
 button(actions,'写复盘',openReflection,'td-small');
 button(actions,'AI 复盘',openReflection,'td-link');
 return box;
}

function renderAssistantSummary(view,parent,ui){
 const{el,button,panel}=ui,c=view.plugin.assistant,box=panel(parent,'Codex 笔记助手');
 box.classList.add('td-assistant-shortcuts');
 const status=el(box,'div','td-assistant-status');
 function paint(){
  const s=c?.state||{};
  status.textContent=!c?'Codex 暂不可用':!c.desktop?'文件助手在 Windows 电脑运行':s.busy?`${s.connected?'已连接':'未连接'} · 处理中…`:s.status&&/^(已连接|未连接)/.test(s.status)?s.status:`${s.connected?'已连接':'未连接'}${s.status?' · '+s.status:''}`;
 }
 const actions=el(box,'div','td-assistant-shortcut-actions');
 button(actions,'打开对话',()=>view.go('assistant'),'td-small');
 button(actions,'整理课程',()=>view.go('courses'),'td-link');
 c?.subscribe?.(view,paint);paint();
 // The view owns navigation and can call this disposer with its existing lifecycle cleanup.
 return()=>c?.unsubscribe?.(view);
}
module.exports={renderReflectionSummary,renderAssistantSummary};
