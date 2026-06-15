
const API='https://voipms-app.onrender.com';
let AUTH=null,currentDID='',currentThread=null,allThreads=[],callTimerInterval=null,callSec=0,editingIdx=-1;
let pendingImageBase64=null,pendingImageUrl=null;
let contacts=JSON.parse(localStorage.getItem('vc_contacts')||'[]');
async function loadContacts(){
  try{
    const r=await fetch(API+'/api/contacts/list',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();
    if(data.success&&Array.isArray(data.contacts)){
      contacts=data.contacts;
      localStorage.setItem('vc_contacts',JSON.stringify(contacts));
      renderContacts();
      renderThreadList(allThreads);
    }
  }catch(e){}
}
const isMobile=()=>window.innerWidth<=768;
function getColor(s){return '#07c160';}
function ini(n){return(n||'?').trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function esc(t){return(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');}
function norm10(s){const d=(s||'').replace(/\D/g,'');return d.length===11&&d[0]==='1'?d.slice(1):d;}
function getContactName(num){const c=contacts.find(c=>norm10(c.num)===norm10(num));return c?c.name:num;}
function getContactNote(num){const c=contacts.find(c=>norm10(c.num)===norm10(num));return c&&c.note?c.note:'';}
function fmtNum(num){if(!num||num.length<10)return num;const n=num.replace(/\D/g,'');return '+1 ('+n.slice(0,3)+') '+n.slice(3,6)+'-'+n.slice(6);}

async function mergeMMS(msgs,contact){
  try{
    const r=await fetch(API+'/api/mms/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID})});
    const data=await r.json();
    if(!data.sms)return msgs;
    const mmsForContact=data.sms.filter(m=>norm10(m.contact)===norm10(contact)&&m.col_media1);
    const merged=[...msgs,...mmsForContact];
    const seen=new Set();
    const dedup=merged.filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true;});
    return dedup.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  }catch(e){return msgs;}
}

// AUTO LOGIN
(function(){
  const saved=localStorage.getItem('vc_auth');
  if(saved){
    document.getElementById('login-screen').style.display='none';
    document.getElementById('loading-screen').style.display='flex';
  }
})();
window.addEventListener('load',()=>{
  const saved=localStorage.getItem('vc_auth');
  if(saved){
    try{
      const a=JSON.parse(saved);
      document.getElementById('l-user').value=a.username;
      document.getElementById('l-pass').value=a.password;
      AUTH=a;
      autoLogin(a);
    }catch(e){localStorage.removeItem('vc_auth');document.getElementById('loading-screen').style.display='none';document.getElementById('login-screen').style.display='flex';}
  }
});

async function autoLogin(a){
  try{
    const r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});
    const data=await r.json();
    if(data.success){
      document.getElementById('loading-screen').style.display='none';
      setupApp(a,data.dids||[]);
    }else{
      localStorage.removeItem('vc_auth');
      document.getElementById('loading-screen').style.display='none';
      document.getElementById('login-screen').style.display='flex';
    }
  }catch(e){
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('login-screen').style.display='flex';
  }
}

async function doLogin(){
  const btn=document.getElementById('login-btn');
  const errEl=document.getElementById('login-error');
  errEl.style.display='none';
  const username=document.getElementById('l-user').value.trim();
  const password=document.getElementById('l-pass').value;
  if(!username||!password){showErr('请填写邮箱和密码');return;}
  btn.disabled=true;btn.textContent='登录中...';
  try{
    const r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const data=await r.json();
    if(data.success){
      AUTH={username,password};
      localStorage.setItem('vc_auth',JSON.stringify(AUTH));
      setupApp(AUTH,data.dids||[]);
      showToast('登录成功','success');
    }else{showErr(data.error||'用户名或密码错误');}
  }catch(e){showErr('无法连接服务器');}
  btn.disabled=false;btn.textContent='登录';
}

function setupApp(auth,dids){
  AUTH=auth;
  const sel=document.getElementById('did-selector');
  sel.innerHTML='';
  dids.forEach(d=>{const o=document.createElement('option');o.value=d.did;o.textContent='+1('+d.did.slice(0,3)+')'+d.did.slice(3,6)+'-'+d.did.slice(6);sel.appendChild(o);});
  if(dids.length>0)currentDID=dids[0].did;
  document.getElementById('user-avatar').textContent=auth.username[0].toUpperCase();
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';
  loadThreads();
  renderContacts();
  loadContacts();
  loadCallLog();
}

function showErr(msg){const el=document.getElementById('login-error');el.textContent=msg;el.style.display='block';}

function doLogout(){
  if(!confirm('确定要退出登录吗？'))return;
  AUTH=null;currentDID='';currentThread=null;
  localStorage.removeItem('vc_auth');
  document.getElementById('app-screen').style.display='none';
  document.getElementById('login-screen').style.display='flex';
}

function onDIDChange(){currentDID=document.getElementById('did-selector').value;loadThreads();}

function switchTab(tab){
  ['chats','contacts','calls'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
    document.getElementById('panel-'+t).style.display=t===tab?'flex':'none';
  });
  if(tab==='calls')loadCallLog();
  if(tab==='contacts')renderContacts();
}

function switchMobTab(tab){
  ['chats','contacts','calls'].forEach(t=>{
    document.getElementById('mob-tab-'+t).classList.toggle('active',t===tab);
    document.getElementById('mob-panel-'+t).style.display=t===tab?'flex':'none';
  });
  if(tab==='calls')loadCallLog();
  if(tab==='contacts')renderContacts();
}

function switchMobileView(v){
  ['chats','contacts','calls','new'].forEach(n=>{const b=document.getElementById('mob-nav-'+n);if(b)b.classList.remove('active');});
  const nb=document.getElementById('mob-nav-'+v);if(nb)nb.classList.add('active');
  document.getElementById('mobile-list-view').style.display='flex';
  document.getElementById('mobile-chat-view').style.display='none';
  if(v==='chats')switchMobTab('chats');
  if(v==='contacts')switchMobTab('contacts');
  if(v==='calls')switchMobTab('calls');
}

function mobileBack(){
  document.getElementById('mobile-chat-view').style.display='none';
  document.getElementById('mobile-list-view').style.display='flex';
}

async function loadThreads(){
  if(!AUTH||!currentDID)return;
  try{
    const r=await fetch(API+'/api/sms/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID})});
    const data=await r.json();
    const sms=data.sms||[];
    const map={};
    sms.forEach(m=>{
      const key=m.contact;
      if(!map[key])map[key]={contact:key,msgs:[],lastTime:m.date};
      map[key].msgs.push(m);
      if(m.date>map[key].lastTime)map[key].lastTime=m.date;
    });
    allThreads=Object.values(map).sort((a,b)=>b.lastTime.localeCompare(a.lastTime));
    renderThreadList(allThreads);
  }catch(e){console.log('loadThreads error:',e);}
}

function renderThreadList(threads){
  ['thread-list','mob-thread-list'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(threads.length===0){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3)">暂无消息<br><small>点击右下角+新建对话</small></div>';return;}
    el.innerHTML='';
    threads.forEach(t=>{
      const name=getContactName(t.contact);
      const hasName=(name!==t.contact);
      const last=t.msgs.length>0?t.msgs[t.msgs.length-1]:{date:t.lastTime,message:'',type:''};
      const color=getColor(name);
      const div=document.createElement('div');
      div.className='thread-item'+(currentThread&&currentThread.contact===t.contact?' active':'');
      const avatarContent=hasName?ini(name):'<i class="ti ti-phone" style="font-size:18px"></i>';
      const displayName=hasName?(name+' ('+fmtNum(t.contact)+')'):fmtNum(t.contact);
      div.innerHTML=`<div class="t-avatar" style="background:${color}">${avatarContent}</div><div class="t-info"><div class="t-top"><span class="t-name">${esc(displayName)}</span><span class="t-time">${fmtTime(last.date)}</span></div><div class="t-bottom"><span class="t-preview">${(last.type==='0'||last.type===0||last.type==='sent')?'你: ':''}${esc((last.message||'新对话').slice(0,35))}</span></div></div>`;
      div.onclick=()=>openThread(t);
      el.appendChild(div);
    });
  });
}

function filterThreads(q){renderThreadList(q?allThreads.filter(t=>getContactName(t.contact).toLowerCase().includes(q.toLowerCase())||t.contact.includes(q)):allThreads);}
function filterThreadsMob(q){filterThreads(q);}

function fmtTime(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr),now=new Date();
  const diff=now-d;
  if(diff<86400000&&d.getDate()===now.getDate())return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  if(diff<604800000)return['日','一','二','三','四','五','六'][d.getDay()]&&'周'+['日','一','二','三','四','五','六'][d.getDay()];
  return(d.getMonth()+1)+'/'+(d.getDate());
}

function fmtDayLabel(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr),now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const target=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const diff=(today-target)/86400000;
  if(diff===0)return'今天';
  if(diff===1)return'昨天';
  if(diff<7)return['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
}

async function openThread(t){
  currentThread=t;
  const name=getContactName(t.contact);
  const color=getColor(name);
  const i=ini(name);
  const note=getContactNote(t.contact);
  const hasName=(name!==t.contact);
  if(isMobile()){
    document.getElementById('mobile-list-view').style.display='none';
    document.getElementById('mobile-chat-view').style.display='flex';
    document.getElementById('mob-chat-avatar').textContent=i;
    document.getElementById('mob-chat-avatar').style.background=color;
    document.getElementById('mob-chat-name').textContent=hasName?(name+' '+fmtNum(t.contact)):fmtNum(t.contact);
    document.getElementById('mob-chat-num').textContent=note||(hasName?t.contact:'');
  }else{
    document.getElementById('empty-chat').style.display='none';
    document.getElementById('chat-container').style.display='flex';
    document.getElementById('chat-avatar').textContent=i;
    document.getElementById('chat-avatar').style.background=color;
    document.getElementById('chat-name').textContent=hasName?(name+' '+fmtNum(t.contact)):fmtNum(t.contact);
    document.getElementById('chat-num').textContent=note||(hasName?t.contact:'');
  }
  const sortedMsgs=[...t.msgs].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  renderMessages(isMobile()?'mob-messages':'messages',sortedMsgs);
  renderThreadList(allThreads);
  try{
    const r=await fetch(API+'/api/sms/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID,contact:norm10(t.contact)})});
    const data=await r.json();
    if(data.sms){
      let msgs=data.sms.sort((a,b)=>a.date.localeCompare(b.date));
      msgs=await mergeMMS(msgs,t.contact);
      t.msgs=msgs;renderMessages(isMobile()?'mob-messages':'messages',msgs);
    }
  }catch(e){}
}

function renderMessages(elId,msgs){
  const el=document.getElementById(elId);if(!el)return;
  el.innerHTML='';
  let lastDate='';
  msgs.forEach(m=>{
    const ds=(m.date||'').slice(0,10);
    if(ds!==lastDate){const d=document.createElement('div');d.className='day-label';d.innerHTML=`<span>${fmtDayLabel(ds)}</span>`;el.appendChild(d);lastDate=ds;}
    const sent=(m.type==='0'||m.type===0||m.type==='sent');
    const row=document.createElement('div');
    row.className='msg-row '+(sent?'sent':'recv');
    const time=(m.date||'').slice(11,16);
    const hasImg=m.col_media1&&m.col_media1.length>0;
    const bodyHtml=hasImg
      ? '<img src="'+esc(m.col_media1)+'" style="max-width:240px;border-radius:8px;display:block;'+(m.message?'margin-bottom:4px;':'')+'">'+(m.message?'<div class="msg-text">'+esc(m.message)+'</div>':'')
      : '<div class="msg-text">'+esc(m.message||'')+'</div>';
    row.innerHTML='<div class="msg-bubble">'+bodyHtml+'<div class="msg-meta"><span class="msg-time">'+time+'</span>'+(sent?'<i class="ti ti-checks msg-tick read"></i>':'')+'</div></div>';
    el.appendChild(row);
  });
  el.scrollTop=el.scrollHeight;
}

async function refreshMessages(){
  if(!currentThread)return;
  showToast('刷新中...','info');
  try{
    const r=await fetch(API+'/api/sms/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID,contact:norm10(currentThread.contact)})});
    const data=await r.json();
    if(data.sms){
      let msgs=data.sms.sort((a,b)=>a.date.localeCompare(b.date));
      msgs=await mergeMMS(msgs,currentThread.contact);
      currentThread.msgs=msgs;renderMessages(isMobile()?'mob-messages':'messages',msgs);showToast('已刷新','success');
    }
  }catch(e){showToast('刷新失败','error');}
}

async function sendMessage(){const inp=document.getElementById('msg-input');const text=inp.value.trim();if(!currentThread||(!text&&!pendingImageBase64))return;inp.value='';inp.style.height='auto';await doSend(text,'messages');}
async function sendMessageMob(){const inp=document.getElementById('mob-msg-input');const text=inp.value.trim();if(!currentThread||(!text&&!pendingImageBase64))return;inp.value='';inp.style.height='auto';await doSend(text,'mob-messages');}

async function doSend(text,elId){
  const el=document.getElementById(elId);
  const now=new Date();
  const time=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const hasImg=!!pendingImageBase64;
  const localImgUrl=pendingImageUrl;
  const row=document.createElement('div');
  row.className='msg-row sent';
  const bodyHtml=hasImg
    ? '<img src="'+localImgUrl+'" style="max-width:240px;border-radius:8px;display:block;'+(text?'margin-bottom:4px;':'')+'">'+(text?'<div class="msg-text">'+esc(text)+'</div>':'')
    : '<div class="msg-text">'+esc(text)+'</div>';
  row.innerHTML='<div class="msg-bubble">'+bodyHtml+'<div class="msg-meta"><span class="msg-time">'+time+'</span><i class="ti ti-check msg-tick"></i></div></div>';
  el.appendChild(row);el.scrollTop=el.scrollHeight;
  if(hasImg){
    const base64=pendingImageBase64;
    removePendingImage();
    showToast('上传中...','info');
    try{
      const upRes=await fetch(API+'/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:base64})});
      const upData=await upRes.json();
      if(!upData.success){showToast('图片上传失败','error');return;}
      const sendRes=await fetch(API+'/api/mms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID,dst:currentThread.contact,message:text||'',mediaUrl:upData.url})});
      const sendData=await sendRes.json();
      if(sendData.status==='success'){row.querySelector('.msg-tick').className='ti ti-checks msg-tick read';showToast('发送成功','success');loadThreads();}
      else showToast('MMS发送失败: '+(sendData.status||'错误'),'error');
    }catch(err){showToast('发送失败','error');}
  }else{
    try{
      const r=await fetch(API+'/api/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID,dst:currentThread.contact,message:text})});
      const data=await r.json();
      if(data.status==='success'){row.querySelector('.msg-tick').className='ti ti-checks msg-tick read';showToast('发送成功','success');loadThreads();}
      else showToast('发送失败: '+(data.status||'错误'),'error');
    }catch(e){showToast('发送失败','error');}
  }
}

function removePendingImage(){
  pendingImageBase64=null;
  if(pendingImageUrl){URL.revokeObjectURL(pendingImageUrl);pendingImageUrl=null;}
  ['img-preview','mob-img-preview'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('show');});
}

function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
function handleKeyMob(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessageMob();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

function openNewChat(){document.getElementById('new-chat-num').value='';document.getElementById('modal-new-chat').style.display='flex';setTimeout(()=>document.getElementById('new-chat-num').focus(),100);}
function confirmNewChat(){
  const num=document.getElementById('new-chat-num').value.replace(/\D/g,'');
  if(num.length<10){showToast('请输入10位号码','error');return;}
  closeModal('modal-new-chat');
  const ex=allThreads.find(t=>norm10(t.contact)===norm10(num));
  if(ex){openThread(ex);return;}
  const t={contact:num,msgs:[],lastTime:new Date().toISOString()};
  allThreads.unshift(t);renderThreadList(allThreads);openThread(t);
}

function renderContacts(){
  ['contacts-list','mob-contacts-list'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(contacts.length===0){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3)">暂无联系人<br><small>点击右下角+添加</small></div>';return;}
    el.innerHTML='';
    const sorted=[...contacts].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
    let lastL='';
    sorted.forEach((c,si)=>{
      const l=(c.name[0]||'#').toUpperCase();
      if(l!==lastL){const ld=document.createElement('div');ld.className='contact-letter';ld.textContent=l;el.appendChild(ld);lastL=l;}
      const origIdx=contacts.findIndex(x=>x.name===c.name&&x.num===c.num);
      const color=getColor(c.name);
      const row=document.createElement('div');row.className='contact-item';
      row.innerHTML=`<div class="c-avatar" style="background:${color}">${ini(c.name)}</div><div class="c-info"><div class="c-name">${esc(c.name)}</div><div class="c-num">${c.num}</div></div><div class="c-actions"><button class="c-btn" onclick="event.stopPropagation();msgContact('${c.num}')" title="发短信"><i class="ti ti-message"></i></button><button class="c-btn" onclick="event.stopPropagation();startCallTo('${c.name}','${c.num}')" title="拨打"><i class="ti ti-phone"></i></button><button class="c-btn" onclick="event.stopPropagation();editContact(${origIdx})" title="编辑"><i class="ti ti-pencil"></i></button><button class="c-btn" onclick="event.stopPropagation();deleteContact(${origIdx})" title="删除" style="color:var(--red)"><i class="ti ti-trash"></i></button></div>`;
      el.appendChild(row);
    });
  });
}

function filterContacts(q){
  const el=document.getElementById('contacts-list');if(!el)return;
  const f=contacts.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())||c.num.includes(q));
  el.innerHTML='';f.forEach(c=>{const color=getColor(c.name);const row=document.createElement('div');row.className='contact-item';row.innerHTML=`<div class="c-avatar" style="background:${color}">${ini(c.name)}</div><div class="c-info"><div class="c-name">${esc(c.name)}</div><div class="c-num">${c.num}</div></div>`;el.appendChild(row);});
}
function filterContactsMob(q){filterContacts(q);}

function openAddContact(prefillNum=''){
  editingIdx=-1;
  document.getElementById('contact-modal-title').textContent='添加联系人';
  document.getElementById('contact-name-input').value='';
  document.getElementById('contact-num-input').value=prefillNum;
  document.getElementById('contact-note-input').value='';
  document.getElementById('modal-contact').style.display='flex';
  setTimeout(()=>document.getElementById('contact-name-input').focus(),100);
}
function editContact(i){
  editingIdx=i;
  document.getElementById('contact-modal-title').textContent='编辑联系人';
  document.getElementById('contact-name-input').value=contacts[i].name;
  document.getElementById('contact-num-input').value=contacts[i].num;
  document.getElementById('contact-note-input').value=contacts[i].note||'';
  document.getElementById('modal-contact').style.display='flex';
}
async function saveContact(){
  const name=document.getElementById('contact-name-input').value.trim();
  const num=document.getElementById('contact-num-input').value.replace(/\D/g,'');
  const note=document.getElementById('contact-note-input').value.trim();
  if(!name||!num){showToast('请填写姓名和号码','error');return;}
  if(editingIdx>=0){contacts[editingIdx]={name,num,note};showToast('联系人已更新','success');}
  else{contacts.push({name,num,note});showToast('已添加 '+name,'success');}
  localStorage.setItem('vc_contacts',JSON.stringify(contacts));
  closeModal('modal-contact');renderContacts();renderThreadList(allThreads);
  try{
    await fetch(API+'/api/contacts/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num,name,note})});
  }catch(e){}
}
async function deleteContact(i){
  if(!confirm('确定删除 '+contacts[i].name+' ?'))return;
  const num=contacts[i].num;
  contacts.splice(i,1);localStorage.setItem('vc_contacts',JSON.stringify(contacts));
  renderContacts();showToast('已删除','success');
  try{
    await fetch(API+'/api/contacts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num})});
  }catch(e){}
}
function msgContact(num){
  const ex=allThreads.find(t=>norm10(t.contact)===norm10(num));
  if(isMobile())switchMobileView('chats');else switchTab('chats');
  if(ex){openThread(ex);return;}
  const t={contact:num,msgs:[],lastTime:new Date().toISOString()};
  allThreads.unshift(t);renderThreadList(allThreads);openThread(t);
}
function addCurrentToContacts(){
  if(!currentThread)return;
  const ex=contacts.findIndex(c=>norm10(c.num)===norm10(currentThread.contact));
  if(ex>=0)editContact(ex);
  else openAddContact(currentThread.contact);
}

async function loadCallLog(){
  if(!AUTH)return;
  try{
    const r=await fetch(API+'/api/calls/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password})});
    const data=await r.json();
    renderCallLog(data.cdr||[]);
  }catch(e){}
}
function renderCallLog(cdr){
  ['calls-list','mob-calls-list'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(cdr.length===0){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3)">暂无通话记录</div>';return;}
    el.innerHTML='';
    cdr.slice(0,100).forEach(c=>{
      const ok=c.disposition==='ANSWERED';
      const missed=c.disposition==='NO ANSWER'||c.disposition==='BUSY';
      const color=ok?'var(--green)':missed?'var(--red)':'var(--amber)';
      const icon=ok?'ti-phone-incoming':missed?'ti-phone-missed':'ti-phone-outgoing';
      const name=getContactName(c.callerid||c.destination||'-');
      const callColor=getColor(name);
      const row=document.createElement('div');row.className='call-item';
      row.innerHTML=`<div class="c-avatar" style="width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;background:${callColor}">${ini(name)}</div><div class="c-info" style="flex:1"><div class="c-name" style="color:${color};display:flex;align-items:center;gap:6px;font-size:15px;font-weight:500"><i class="ti ${icon}" style="font-size:14px"></i>${esc(name)}</div><div class="c-num" style="font-size:13px;color:var(--text2);font-family:monospace">${(c.date||'').slice(0,16)} · ${c.seconds||0}秒</div></div><button class="c-btn" onclick="startCallTo('${esc(name)}','${c.callerid||c.destination||''}')" style="color:var(--green)"><i class="ti ti-phone-outgoing"></i></button>`;
      el.appendChild(row);
    });
  });
}

function startCall(){if(!currentThread)return;startCallTo(getContactName(currentThread.contact),currentThread.contact);}
function startCallTo(name,num){
  const color=getColor(name);
  document.getElementById('call-av').textContent=ini(name);
  document.getElementById('call-av').style.background=color;
  document.getElementById('call-name-disp').textContent=name;
  document.getElementById('call-status').textContent='正在拨号...';
  document.getElementById('call-timer').textContent='';
  document.getElementById('call-overlay').style.display='flex';
  callSec=0;
  setTimeout(()=>{
    document.getElementById('call-status').textContent='通话中';
    callTimerInterval=setInterval(()=>{
      callSec++;
      const m=Math.floor(callSec/60).toString().padStart(2,'0');
      const s=(callSec%60).toString().padStart(2,'0');
      document.getElementById('call-timer').textContent=m+':'+s;
    },1000);
  },1500);
}
function endCall(){clearInterval(callTimerInterval);document.getElementById('call-overlay').style.display='none';showToast('通话已结束','info');}

function closeModal(id){document.getElementById(id).style.display='none';}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.style.display='none';});

async function handleFileSelect(e){
  const file=e.target.files[0];
  e.target.value='';
  if(!file||!currentThread)return;
  if(!file.type.startsWith('image/')){showToast('仅支持图片','error');return;}
  if(file.size>5*1024*1024){showToast('图片不能超过5MB','error');return;}
  try{
    const base64=await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(file);
    });
    pendingImageBase64=base64;
    if(pendingImageUrl)URL.revokeObjectURL(pendingImageUrl);
    pendingImageUrl=URL.createObjectURL(file);
    ['img-preview','mob-img-preview'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      el.classList.add('show');
      const img=el.querySelector('img');if(img)img.src=pendingImageUrl;
    });
  }catch(err){showToast('图片读取失败','error');}
}

let toastTimer=null;
function showToast(msg,type){
  const t=document.getElementById('toast');
  const icon=document.getElementById('toast-icon');
  document.getElementById('toast-msg').textContent=msg;
  const colors={success:'var(--green)',error:'var(--red)',info:'#ccc',warn:'var(--amber)'};
  const icons={success:'ti-circle-check',error:'ti-circle-x',info:'ti-info-circle',warn:'ti-alert-triangle'};
  icon.className='ti '+(icons[type]||'ti-info-circle');
  icon.style.color=colors[type]||'var(--green)';
  t.style.display='flex';
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.style.display='none',3000);
}

window.addEventListener('resize',()=>{
  if(!AUTH)return;
  if(!isMobile()){document.getElementById('mobile-list-view').style.display='none';document.getElementById('mobile-chat-view').style.display='none';}
});

// AUTO POLL: 每5秒自动检查新消息
setInterval(async ()=>{
  if(!AUTH||!currentDID)return;
  if(currentThread){
    try{
      const r=await fetch(API+'/api/sms/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:AUTH.username,password:AUTH.password,did:currentDID,contact:norm10(currentThread.contact)})});
      const data=await r.json();
      if(data.sms){
        const msgs=data.sms.sort((a,b)=>a.date.localeCompare(b.date));
        if(JSON.stringify(msgs)!==JSON.stringify(currentThread.msgs)){
          const merged=await mergeMMS(msgs,currentThread.contact);
          currentThread.msgs=merged;
          renderMessages(isMobile()?'mob-messages':'messages',merged);
        }
      }
    }catch(e){}
  }else{
    loadThreads();
  }
},5000);

