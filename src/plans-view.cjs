'use strict';
const C=require('./core.cjs');
const D=require('./dashboard.cjs');
function editor(view,original,ui){
 const {Modal}=require('obsidian'),{el,button,select,heading}=ui,p=view.plugin,token=original?p.store.token('plan',original.id):undefined;
 const plan=JSON.parse(JSON.stringify(original||{id:C.uid(),title:'',status:'open',startDate:C.localDate(),endDate:C.addDays(C.localDate(),14),goals:[],description:'',cover:''}));
 class PlanModal extends Modal{onOpen(){const root=this.contentEl;root.classList.add('td-modal');D.applyTheme(root,p.store.settings.theme);heading(root,'PLAN',original?'编辑计划':'新建计划');const form=el(root,'form','td-form');const field=(parent,label,type,value)=>{const wrap=el(parent,'label','td-field');el(wrap,'span','',label);const input=el(wrap,type==='textarea'?'textarea':'input','td-input');if(type!=='textarea')input.type=type;input.value=value??'';return input;};
  const title=field(form,'计划名称','text',plan.title);title.required=true;const dates=el(form,'div','td-form-grid'),start=field(dates,'开始日期','date',plan.startDate),end=field(dates,'结束日期','date',plan.endDate);start.required=end.required=true;
  const desc=field(form,'计划说明','textarea',plan.description),cover=field(form,'封面图片路径（笔记库内，可选）','text',plan.cover);cover.placeholder='例如：附件/计划封面.jpg';const goals=el(form,'div','td-plan-goal-editor');
  const draw=()=>{goals.replaceChildren();for(const [index,g]of plan.goals.entries()){const box=el(goals,'section','td-plan-goal-form');const name=field(box,`子目标 ${index+1} 名称`,'text',g.title);name.oninput=()=>g.title=name.value;const kind=select(box,[['count','完成数量'],['score','百分制评分']],g.kind,v=>{g.kind=v;if(v==='score'){g.target=100;g.value=Math.min(g.value,100);}draw();});kind.setAttribute('aria-label',`子目标 ${index+1} 类型`);const grid=el(box,'div','td-form-grid'),value=field(grid,`子目标 ${index+1} 当前值`,'number',g.value),target=field(grid,`子目标 ${index+1} 目标值`,'number',g.target);value.min='0';value.max=String(g.target);target.min='0.01';value.step=target.step='any';target.disabled=g.kind==='score';value.oninput=()=>g.value=Number(value.value);target.oninput=()=>{g.target=Number(target.value);value.max=target.value;};const note=field(box,`子目标 ${index+1} 说明`,'text',g.note);note.oninput=()=>g.note=note.value;button(box,'移除此子目标',()=>{plan.goals.splice(index,1);draw();},'td-link');}};draw();
  button(form,'＋ 添加子目标',()=>{plan.goals.push({id:C.uid(),title:'',kind:'count',value:0,target:10,note:''});draw();});const error=el(form,'p','td-error');error.setAttribute('role','alert');const actions=el(form,'div','td-modal-actions');button(actions,'取消',()=>this.close());const save=button(actions,'保存计划',()=>{},'mod-cta');save.type='submit';let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;save.disabled=true;try{Object.assign(plan,{title:title.value.trim(),startDate:start.value,endDate:end.value,description:desc.value,cover:cover.value.trim(),updatedAt:new Date().toISOString()});C.validatePlan(plan);if(plan.cover){const file=p.app.vault.getAbstractFileByPath(plan.cover);if(!file||!['jpg','jpeg','png','webp','gif'].includes(file.extension?.toLowerCase()))throw Error('封面需选择笔记库内已有图片');}await p.store.savePlan(plan,token);p.refresh();this.close();}catch(e){error.textContent=e.message;}finally{busy=false;save.disabled=false;}};
 }onClose(){this.contentEl.replaceChildren();}}
 new PlanModal(p.app).open();
}
function summaryHero(box,plan,progress,ui,scenerySrc,vault){
 const {el,button,edit}=ui;
 const hero=el(box,'div','td-plan-hero');
 const cover=plan.cover&&vault.getAbstractFileByPath(plan.cover);
 const imageSrc=cover?vault.getResourcePath(cover):scenerySrc;
 if(imageSrc){
  const image=el(hero,'img','td-plan-hero-image');
  image.alt='';
  image.onerror=()=>{image.hidden=true;};
  image.src=imageSrc;
 }
 const surface=el(hero,'div','td-plan-hero-surface');
 const info=el(surface,'div','td-plan-hero-info');
 button(info,plan.title,edit,'td-plan-title');
 const today=C.localDate();
 const countdown=plan.endDate<today?'已到期':plan.endDate===today?'今天到期':`剩余 ${progress.remaining} 天`;
 el(info,'strong','td-plan-countdown',countdown);
 el(info,'small','td-muted',`${plan.endDate} 截止 · 自然进度 ${progress.natural}%`);
 const ring=el(surface,'div','td-plan-ring');
 ring.setAttribute('role','progressbar');
 ring.setAttribute('aria-label',plan.title+' 完成进度');
 ring.setAttribute('aria-valuenow',String(progress.actual));
 ring.setAttribute('aria-valuemin','0');
 ring.setAttribute('aria-valuemax','100');
 ring.style.setProperty('--td-plan-progress',progress.actual+'%');
 el(ring,'strong','',progress.actual+'%');
}
function card(view,parent,plan,ui,summary=false,scenerySrc=''){const{el,button}=ui,p=view.plugin,progress=C.planProgress(plan),box=el(parent,'article','td-plan-card');
 const linked=new Map();
 if(!summary){
  box.dataset.planId=plan.id;
  for(const task of p.store.tasks.values()){
   if(task.deleted||task.planGoal?.planId!==plan.id)continue;
   const id=task.planGoal.goalId;
   if(!linked.has(id))linked.set(id,[]);
   linked.get(id).push(task);
  }
 }
 if(plan.cover&&!summary){const file=p.app.vault.getAbstractFileByPath(plan.cover);if(file){const image=el(box,'img','td-plan-cover');image.src=p.app.vault.getResourcePath(file);image.alt=plan.title;image.onerror=()=>image.hidden=true;}}
 if(summary){
  box.classList.add('td-plan-card-summary');
  summaryHero(box,plan,progress,{el,button,edit:()=>editor(view,plan,ui)},scenerySrc,p.app.vault);
 }else{
  const top=el(box,'div','td-plan-card-heading');button(top,plan.title,()=>editor(view,plan,ui),'td-plan-title');el(top,'small','td-muted',`${plan.startDate} — ${plan.endDate}`);el(box,'span','td-plan-days',plan.status==='done'?'已完成':`${plan.endDate<C.localDate()?'已到期':'还剩 '+progress.remaining+' 天'}`);if(plan.description)el(box,'p','td-muted',plan.description);
  const label=el(box,'div','td-plan-progress-label');el(label,'span','',`自然进度 ${progress.natural}% · ${progress.delta>=0?'领先':'落后'} ${Math.abs(progress.delta)}%`);el(label,'strong','',`${progress.actual}%`);const track=el(box,'div','td-plan-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label',plan.title+' 完成进度');track.setAttribute('aria-valuenow',String(progress.actual));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');const bar=el(track,'div','td-plan-fill');bar.style.width=progress.actual+'%';const marker=el(track,'span','td-plan-natural');marker.style.left=progress.natural+'%';
 }
 for(const g of plan.goals){
  const row=el(box,'div','td-plan-goal');
  row.dataset.goalId=g.id;
  el(row,'strong','',g.title);
  const meter=el(row,'progress','');meter.max=g.target;meter.value=g.value;meter.setAttribute('aria-label',g.title);
  el(row,'span','',g.kind==='score'?`${g.value} 分`:`${g.value}/${g.target}`);
  if(g.note)el(row,'small','td-muted',g.note);
  if(summary)continue;
  const actions=el(row,'div','td-plan-task-actions');
  if(plan.status==='open'){
   const next=button(actions,'＋ 创建下一步',()=>p.quickTask({planId:plan.id,goalId:g.id}),'td-link');
   next.setAttribute('aria-label','创建下一步：'+g.title);
  }
  const tasks=linked.get(g.id)||[];
  if(!tasks.length)continue;
  const details=el(actions,'details','td-plan-linked-tasks');
  el(details,'summary','',`关联任务 · ${tasks.filter(t=>t.status==='done').length}/${tasks.length} 已完成`);
  for(const task of tasks){
   const title=task.status==='done'?'已完成 · ':'待完成 · ';
   button(details,title+task.title+(task.date?' · '+task.date:''),()=>p.editTask(task),'td-link');
  }
 }
 if(!plan.goals.length)button(box,'＋ 添加子目标',()=>editor(view,plan,ui),'td-plan-add');
 if(!summary){const actions=el(box,'div','td-modal-actions');button(actions,'编辑计划 / 更新进度',()=>editor(view,plan,ui));const token=p.store.token('plan',plan.id);button(actions,plan.status==='done'?'重新打开':'标记完成',()=>p.run(async()=>{await p.store.savePlan({...plan,status:plan.status==='done'?'open':'done'},token);p.refresh();}));button(actions,'删除计划',()=>{const {Modal}=require('obsidian');class Confirm extends Modal{onOpen(){el(this.contentEl,'p','',`确认删除“${plan.title}”？`);button(this.contentEl,'取消',()=>this.close());button(this.contentEl,'确认删除',()=>p.run(async()=>{await p.store.savePlan({...plan,deleted:true},token);this.close();p.refresh();}),'td-danger');}}new Confirm(p.app).open();},'td-link');}
 return box;
}
function renderPlans(view,parent,ui){const{el,button,heading}=ui;heading(parent,'GROW AT YOUR PACE','计划','把长期目标，拆成每天看得见的进步。','🎯');const nav=el(parent,'div','td-work-switcher');for(const[key,label,icon]of [['open','进行中','🚀'],['done','已完成','🏆']])button(nav,label,()=>{view.state.planStatus=key;view.render();},(view.state.planStatus||'open')===key?'is-active':'',icon);button(nav,'＋ 新建计划',()=>editor(view,null,ui),'mod-cta');const plans=[...(view.plugin.store.plans?.values()||[])].filter(x=>!x.deleted&&x.status===(view.state.planStatus||'open'));if(!plans.length)el(parent,'div','td-empty','这里还没有计划，创建一个目标开始吧。');const grid=el(parent,'div','td-plans-grid');for(const p of plans)card(view,grid,p,ui);}
function summary(view,parent,ui,scenerySrc){const{el,select,button,panel}=ui,box=panel(parent,'我的计划',h=>button(h,'全部计划 ↗',()=>view.go('plans'),'td-link'),'🎯'),plans=[...(view.plugin.store.plans?.values()||[])].filter(p=>!p.deleted&&p.status==='open');if(!plans.length){button(box,'＋ 创建计划',()=>editor(view,null,ui));return;}const selected=plans.find(p=>p.id===view.plugin.store.settings.homePlanId)||plans[0];select(box,plans.map(p=>[p.id,p.title]),selected.id,id=>view.plugin.run(()=>view.plugin.updateSettings({homePlanId:id}))).setAttribute('aria-label','首页显示的计划');const scroll=el(box,'div','td-plan-summary-scroll');card(view,scroll,selected,ui,true,scenerySrc);}
module.exports={renderPlans,summary,editor,card};
