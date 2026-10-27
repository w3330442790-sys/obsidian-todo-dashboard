'use strict';
const WIDGETS=['stats','focus','today','recent','custom','assistant'];
const NAMES={stats:'概览统计',focus:'专注计时',today:'今日待办',recent:'最近笔记',custom:'笔记统计',assistant:'Codex 助手'};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const clamp=(n,a,b,f)=>Number.isFinite(Number(n))?Math.min(b,Math.max(a,Number(n))):f;
function normalizeLayout(input){
 const raw=object(input),order=[...new Set((Array.isArray(raw.order)?raw.order:[]).filter(id=>WIDGETS.includes(id)))];for(const id of WIDGETS)if(!order.includes(id))order.push(id);
 const result={order};for(const device of ['desktop','tablet']){result[device]={};for(const id of WIDGETS){const s=object(object(raw[device])[id]);result[device][id]={span:s.span===12?12:s.span===6?6:['today','recent'].includes(id)?6:12,height:s.height==null?null:clamp(s.height,180,900,null)};}}return result;
}
function moveWidget(input,id,before){const x=normalizeLayout(input);if(!WIDGETS.includes(id)||!WIDGETS.includes(before)||id===before)return x;x.order=x.order.filter(k=>k!==id);x.order.splice(x.order.indexOf(before),0,id);return x;}
function dailyImage(paths,date,fixed){const sorted=[...new Set(paths)].sort();if(fixed&&sorted.includes(fixed))return fixed;if(!sorted.length)return null;const parts=String(date).split('-').map(Number),day=Math.floor(Date.UTC(parts[0],parts[1]-1,parts[2])/86400000);return sorted[(Math.abs(day)||0)%sorted.length];}
function placeWidgets(view,parent,blocks,ui){
 const{el,button,select}=ui,p=view.plugin,layout=normalizeLayout(p.store.settings.dashboard),device=p.layoutDevice||(view.contentEl.clientWidth<900?'tablet':'desktop');
 const grid=el(parent,'div','td-widget-grid'+(view.state.editLayout?' is-editing':''));grid.dataset.device=device;
 const revision=p.store.token('settings','settings');const save=x=>p.run(()=>p.updateSettings({dashboard:normalizeLayout(x)},revision));
 for(const id of layout.order){
  const box=el(grid,'section','td-widget');box.dataset.widget=id;box.setAttribute('aria-label',NAMES[id]+'模块');const size=layout[device][id];box.style.gridColumn=`span ${size.span}`;
  if(size.height){box.style.height=size.height+'px';box.classList.add('has-custom-height');}
  if(view.state.editLayout){
   const controls=el(box,'div','td-widget-controls');const grip=button(controls,'⠿ '+NAMES[id],()=>{},'td-widget-grip');grip.setAttribute('aria-label','拖动 '+NAMES[id]);
   button(controls,'↑',()=>{const at=layout.order.indexOf(id);if(at>0)save(moveWidget(layout,id,layout.order[at-1]));},'td-small').setAttribute('aria-label','上移 '+NAMES[id]);
   button(controls,'↓',()=>{const at=layout.order.indexOf(id);if(at<layout.order.length-1){const x=normalizeLayout(layout);[x.order[at],x.order[at+1]]=[x.order[at+1],x.order[at]];save(x);}},'td-small').setAttribute('aria-label','下移 '+NAMES[id]);
   select(controls,[['6','半宽'],['12','全宽']],String(size.span),value=>{const x=normalizeLayout(layout);x[device][id].span=Number(value);save(x);}).setAttribute('aria-label',NAMES[id]+'宽度');
   button(controls,'自动高度',()=>{const x=normalizeLayout(layout);x[device][id].height=null;save(x);},'td-small');
   grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();p.interacting=true;grip.setPointerCapture(event.pointerId);box.classList.add('is-dragging');let target=null;
    const move=e=>{const hit=box.ownerDocument.elementFromPoint(e.clientX,e.clientY)?.closest('[data-widget]');for(const child of grid.children)child.classList.remove('is-drop-target');if(hit&&hit!==box&&hit.parentElement===grid){target=hit.dataset.widget;hit.classList.add('is-drop-target');}else target=null;};
    let ended=false;const end=e=>{if(ended)return;ended=true;p.interacting=false;grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',end);grip.removeEventListener('pointercancel',cancel);grip.removeEventListener('lostpointercapture',cancel);box.classList.remove('is-dragging');for(const child of grid.children)child.classList.remove('is-drop-target');if(target&&e.type==='pointerup')save(moveWidget(layout,id,target));else if(p.pendingRefresh)p.refresh();};const cancel=e=>end(e);
    grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',cancel);grip.addEventListener('lostpointercapture',cancel);
   });
  }
  const body=el(box,'div','td-widget-body');blocks[id](body);
  if(view.state.editLayout){const handle=button(box,'↘',()=>{},'td-resize-handle');handle.setAttribute('aria-label','调整 '+NAMES[id]+'大小');
   handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();p.interacting=true;handle.setPointerCapture(event.pointerId);const r=box.getBoundingClientRect(),startX=event.clientX,startY=event.clientY;let width=r.width,height=r.height;
    const move=e=>{width=Math.max(180,r.width+e.clientX-startX);height=clamp(r.height+e.clientY-startY,180,900,r.height);box.style.height=height+'px';box.classList.add('has-custom-height');box.style.gridColumn=`span ${width>grid.clientWidth*.7?12:6}`;};
    let ended=false;const end=e=>{if(ended)return;ended=true;p.interacting=false;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);if(e.type==='pointerup'){const x=normalizeLayout(layout);x[device][id]={span:width>grid.clientWidth*.7?12:6,height:Math.round(height)};save(x);}else if(box.isConnected)view.render();};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
   });
  }
 }
 return grid;
}
module.exports={WIDGETS,NAMES,normalizeLayout,moveWidget,dailyImage,clamp,placeWidgets};
