import {GalaxyHID,BLOCKS,readShortcutLocks,writeShortcutLocks,hex,fromHex,keyAction,applyKey,compileMacroBank,parseMacroBank,validateProfile,delay} from './protocol.js';
import {AutoApply} from './auto-apply.js';
import {WirelessHID,validateWireless} from './wireless.js';
const $=id=>document.getElementById(id);
const layout=await fetch('./layout.json').then(r=>r.json());
const keys=layout.map(k=>({...k,code:Number(k.code),index:Number(k.key_index),light:Number(k.light_index)}));
const state={hid:null,view:'keys',layer:'keys',selected:keys[0],blocks:{},backup:null,confirmed:null,dirty:new Set(),macros:[],macroSlot:0,macroParsed:true,recording:false,recordedPressed:new Map(),logs:[],running:false,media:[],audioContext:null,frameCount:0};
for(const [name,spec] of Object.entries(BLOCKS))state.blocks[name]=new Uint8Array(spec.pages*64);
state.blocks.lighting.set([1,167,139,250,0,0,0,0,0,5,3,0,0,0,170,85]);state.blocks.settings[1]=1;state.blocks.settings[6]=1;state.blocks.settings[8]=1;
const descriptions={keys:['每一键，都由你定义。','点击键盘上的按键，为它分配新的功能。'],lighting:['点亮你的灵感。','20 种板载灯效，为桌面找到自己的氛围。'],colors:['为每一键，选一种颜色。','用逐键 RGB 描绘你的专属配色。'],realtime:['让光，跟随你的节奏。','动态灯效、音乐律动与屏幕颜色同步。'],macros:['复杂操作，一键完成。','录制按键序列，编辑延迟，再绑定到任意按键。'],settings:['调到最适合你的状态。','调整响应、休眠和游戏防误触选项。'],profiles:['把习惯，随身带走。','备份设备配置，保存和切换你的专属方案。'],diagnostics:['保持连接，一切有迹可循。','查看设备信息、通信结果和固件文件检查。']};
const effectNames=['静态恒亮','单点亮','单熄灭','繁星点点','漫天飞雪','百花争艳','动态呼吸','光谱循环','彩泉涌动','多彩纵横','随波逐流','峰回路转','一触即发','一石二鸟','涟漪扩散','川流不息','重峦叠嶂','斜风细雨','来回穿梭','关闭背光'];
const mediaActions=[[0xcd,'播放 / 暂停'],[0xb7,'停止播放'],[0xb6,'上一曲'],[0xb5,'下一曲'],[0xe9,'音量 +'],[0xea,'音量 −'],[0xe2,'静音'],[0x192,'计算器'],[0x18a,'邮件'],[0x223,'浏览器主页'],[0x227,'刷新'],[0x224,'浏览器后退'],[0x225,'浏览器前进'],[0x221,'搜索']];
const codeLabel=new Map(keys.map(k=>[k.code,k.name]));
const browserCodes={Escape:41,Backquote:53,Minus:45,Equal:46,Backspace:42,Tab:43,BracketLeft:47,BracketRight:48,Backslash:49,CapsLock:57,Semicolon:51,Quote:52,Enter:40,Comma:54,Period:55,Slash:56,Space:44,ControlLeft:224,ShiftLeft:225,AltLeft:226,MetaLeft:227,ControlRight:228,ShiftRight:229,AltRight:230,MetaRight:231,Insert:73,Home:74,PageUp:75,Delete:76,End:77,PageDown:78,ArrowRight:79,ArrowLeft:80,ArrowDown:81,ArrowUp:82,PrintScreen:70,ScrollLock:71,Pause:72,ContextMenu:101};
for(let i=0;i<26;i++)browserCodes['Key'+String.fromCharCode(65+i)]=4+i;
for(let i=1;i<=9;i++)browserCodes['Digit'+i]=29+i;browserCodes.Digit0=39;
for(let i=1;i<=12;i++)browserCodes['F'+i]=57+i;
const copyBlocks=b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v.slice()]));
function notice(message,type=''){ $('noticeText').textContent=message;$('notice').className='notice '+type;}
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function log(direction,b){state.logs.push({time:new Date().toISOString(),direction,data:hex(b)});state.logs=state.logs.slice(-1000);$('log').textContent=state.logs.slice(-16).map(l=>`${l.time.slice(11,23)} ${l.direction} ${l.data}`).join('\n');}
let working=false;
const autoApply=new AutoApply({
 ready:()=>!working&&!state.running&&!state.recording&&!!state.backup&&!!state.hid?.device.opened&&!state.hid.faulted,
 write:async(name,isCurrent)=>{
  notice('正在应用修改…');refreshStatus();
  if(name==='macros'){if(!state.macroParsed)throw Error('已有宏格式未识别，无法覆盖');state.blocks.macros=compileMacroBank(state.macros);}
  await saveBlock(name,isCurrent);
 },
 onError:e=>{notice('应用失败：'+e.message,'error');toast('修改尚未应用：'+e.message);console.error(e);},
 onIdle:()=>{refreshStatus();if(!state.dirty.size&&state.hid?.device.opened)notice(state.hid.wireless?'已自动应用，键盘已返回无线确认。':'已自动应用，设备读回校验通过。','success');}
});
async function work(fn){if(working||autoApply.active){toast('当前操作进行中，请稍候');return;}working=true;document.body.classList.add('busy');refreshStatus();try{await fn();}catch(e){notice(e.message,'error');toast(e.message);console.error(e);}finally{working=false;document.body.classList.remove('busy');refreshStatus();autoApply.schedule();}}
function hasDevice(){if(!state.hid||!state.backup)throw Error('请先连接键盘并载入配置');if(state.hid.faulted)throw Error(state.hid.wireless?'无线通信中断，请按键唤醒键盘，然后断开并重新连接':'通信异常，请重新插拔键盘再连接');}
function refreshStatus(){
 const connected=state.hid?.device.opened;
 $('sideStatus').textContent=connected?(state.hid.faulted?'通信中断':(state.hid.wireless?'已连接 · 2.4G':'已连接 · USB')):'尚未连接';$('statusDot').className=connected&&!state.hid.faulted?'on':'';
 $('connectionLabel').textContent=connected?(state.hid.wireless?`2.4G · 电量 ${state.hid.battery ?? '—'}%`:'USB 已连接'):'离线编辑';$('connect').hidden=!!connected;$('disconnect').hidden=!connected;
 $('save').disabled=working||!connected||!state.backup||!!state.hid?.faulted||state.running||!['keys','lighting','colors','settings','macros'].includes(state.view);
 $('readDevice').disabled=working||autoApply.active||!connected||state.running||!!state.hid?.wireless;
 $('readDevice').title=state.hid?.wireless?'无线不支持完整配置读回；页面使用最近一次备份及已确认的修改':'从键盘读取最新配置';
 $('startRealtime').disabled=!!state.hid?.wireless||state.running;
 if(state.hid?.wireless)$('realtimeStatus').textContent='2.4G 当前支持板载灯效和逐键配色；实时画面同步请使用有线连接。';$('connect').disabled=working;
 $('applyProfile').disabled=working||!connected||!state.backup||state.running||!!state.hid?.faulted;
 $('draftStatus').textContent=working||autoApply.active?'正在应用 / 读取…':state.dirty.size?(connected?'修改等待应用':'离线草稿 · 连接后编辑可自动应用'):connected?(state.hid.wireless?'2.4G · 最近配置 · 修改自动应用':'已与键盘同步 · 修改自动应用'):'离线草稿 · 未写入设备';
}
function dirty(name){
 state.dirty.add(name);autoApply.mark(name);
 if(name==='colors'){
  const light=new Uint8Array(64);light[0]=128;light[9]=Number($('customBrightness').value);
  state.blocks.lighting=light;state.dirty.add('lighting');autoApply.mark('lighting');
 }
 refreshStatus();renderKeyboard();
}
function setView(view){if(!descriptions[view])view='keys';state.view=view;document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelectorAll('.view').forEach(e=>e.classList.toggle('active',e.id==='view-'+view));[$('pageTitle').textContent,$('pageDescription').textContent]=descriptions[view];$('keyboardSection').hidden=!['keys','lighting','colors','realtime'].includes(view);$('layers').hidden=view!=='keys';$('keyboardHint').hidden=view!=='colors';renderKeyboard();refreshStatus();}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{location.hash=b.dataset.view;setView(b.dataset.view);});window.onhashchange=()=>setView(location.hash.slice(1));
document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{state.layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(n=>n.classList.toggle('selected',n===b));renderKeyboard();readKeyEditor();});
function keyName(k){return ({print:'PrtSc','scrl lock':'ScrLk',pause:'Pause',insert:'Ins',home:'Home',end:'End',pgup:'PgUp','PgDn':'PgDn',CapsLock:'Caps',Backspace:'⌫',Enter:'Enter ↵',Left:'←',Right:'→',Up:'↑',Down:'↓','L_Win':'Win','L_Ctrl':'Ctrl','R_Ctrl':'Ctrl','L_Alt':'Alt','R_Alt':'Alt','L_Shift':'Shift','R_Shift':'Shift'})[k.name]||k.name;}
function renderKeyboard(){
 const board=$('keyboard');board.replaceChildren();
 keys.forEach(k=>{
  const b=document.createElement('button');b.className='key';b.type='button';b.dataset.index=k.index;b.dataset.code=k.code;b.title=k.name;b.setAttribute('aria-label',k.name);
  const dark=k.code>=58||k.code<44||k.code>=224;b.classList.toggle('dark',dark);b.classList.toggle('accent',k.code===41||k.code===40||k.name.toLowerCase()==='fn');
  b.style.left=((Number(k.rect_left)-34)/740*100)+'%';b.style.top=((Number(k.rect_top)-14)/278*100)+'%';b.style.width=((Number(k.rect_width)+4)/740*100)+'%';b.style.height=((Number(k.rect_height)+5)/278*100)+'%';
  b.textContent=keyName(k);b.classList.toggle('selected',state.view==='keys'&&state.selected===k);
  const block=state.blocks[state.layer];b.classList.toggle('changed',state.view==='keys'&&block.slice(k.index*4,k.index*4+4).some(v=>v));
  if(state.view==='colors'){const p=k.light*4;const color=state.blocks.colors.slice(p+1,p+4);b.classList.add('colored');b.style.setProperty('--key-color',`rgb(${color.join(',')})`);}
  b.onclick=()=>{state.selected=k;if(state.view==='colors'){const p=k.light*4;state.blocks.colors.set([k.light,...rgb($('paintColor').value)],p);dirty('colors');}else{renderKeyboard();readKeyEditor();}};
  board.append(b);
 });
 $('selectionLabel').replaceChildren(document.createTextNode('已选择 '));const strong=document.createElement('strong');strong.textContent=state.selected.name;$('selectionLabel').append(strong);$('selectedTag').textContent=state.selected.name;
}
function fillSelect(element,items){element.replaceChildren(...items.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));}
function fillActionOptions(){
 const type=$('actionType').value;let options=[];
 if(type==='key'||type==='multi')options=keys.filter(k=>!/^fn$/i.test(k.name)).map(k=>[k.code,k.name]);
 if(type==='media')options=mediaActions;
 if(type==='mouse')options=[[1,'鼠标左键'],[2,'鼠标右键'],[4,'鼠标中键'],[8,'鼠标按钮 4'],[16,'鼠标按钮 5']];
 if(type==='macro')options=state.macros.flatMap((m,i)=>m?[[i,m.name]]:[]);
 fillSelect($('actionValue'),options);$('actionValueLabel').hidden=!options.length;$('modifierRow').hidden=type!=='key';$('macroOptions').hidden=type!=='macro';$('multiOptions').hidden=type!=='multi';
 $('mappingSummary').textContent=type==='default'?'保留键盘原始功能':type==='disabled'?'此按键将不输出任何内容':type==='macro'&&!options.length?'先在宏管理器中创建一个宏':'修改后自动应用到键盘';
}
$('actionType').onchange=()=>{fillActionOptions();if($('actionType').value!=='macro'||state.macros[Number($('actionValue').value)])$('setKey').click();};
function readKeyEditor(){
 const a=state.blocks[state.layer].slice(state.selected.index*4,state.selected.index*4+4);let type=({1:'mouse',2:'key',3:'media',6:'macro',7:'multi'})[a[0]]||(a[0]===5&&a[1]===3?'disabled':'default');
 $('actionType').value=type;fillActionOptions();
 if(type==='key'){$('actionValue').value=a[2]||224;document.querySelectorAll('#modifierRow input').forEach(c=>c.checked=!!(a[1]&Number(c.value)));}
 if(type==='media')$('actionValue').value=a[1]|a[2]<<8;
 if(type==='mouse')$('actionValue').value=a[2];
 if(type==='macro'){$('actionValue').value=a[1];$('macroMode').value=a[2];$('macroRepeat').value=a[3]||1;}
 if(type==='multi'){$('actionValue').value=a[1];$('multi2').value=a[2];$('multi3').value=a[3];}
 $('setKey').disabled=/^fn$/i.test(state.selected.name);if($('setKey').disabled)$('mappingSummary').textContent='Fn 保留为层切换键';
}
$('setKey').onclick=()=>{if(/^fn$/i.test(state.selected.name))return;try{const type=$('actionType').value;if(type==='macro'&&!state.macros[Number($('actionValue').value)])throw Error('请先创建宏');let mod=0,extra=0;if(type==='key')document.querySelectorAll('#modifierRow input:checked').forEach(c=>mod|=Number(c.value));if(type==='macro'){mod=Number($('macroMode').value);extra=Number($('macroRepeat').value);}if(type==='multi'){mod=Number($('multi2').value);extra=Number($('multi3').value);}const action=keyAction(type,Number($('actionValue').value)||0,mod,extra);state.blocks[state.layer]=applyKey(state.blocks[state.layer],state.selected.index,action);dirty(state.layer);}catch(e){toast(e.message);}};
['actionValue','macroMode','macroRepeat','multi2','multi3'].forEach(id=>$(id).onchange=()=>$('setKey').click());
document.querySelectorAll('#modifierRow input').forEach(c=>c.onchange=()=>$('setKey').click());
fillSelect($('multi2'),keys.map(k=>[k.code,k.name]));fillSelect($('multi3'),keys.map(k=>[k.code,k.name]));
const rgb=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
const colorHex=a=>'#'+Array.from(a,v=>v.toString(16).padStart(2,'0')).join('');
effectNames.forEach((name,i)=>{const b=document.createElement('button');b.className='effect';const dot=document.createElement('i');dot.style.setProperty('--hue',i*19);b.append(dot,document.createTextNode(name));b.dataset.mode=i+1;b.onclick=()=>{state.blocks.lighting[0]=i+1;dirty('lighting');syncLighting();};$('effects').append(b);});
function syncLighting(){const b=state.blocks.lighting;document.querySelectorAll('.effect').forEach(e=>e.classList.toggle('active',Number(e.dataset.mode)===b[0]));$('lightColor').value=colorHex(b.slice(1,4));$('brightness').value=Math.min(b[9],5);$('speed').value=Math.max(1,Math.min(b[10],5));$('multicolor').checked=!!b[8];$('direction').value=b[11];$('brightnessValue').textContent=b[9];$('speedValue').textContent=b[10];}
function editLighting(){const b=state.blocks.lighting;b.set(rgb($('lightColor').value),1);b[8]=$('multicolor').checked?1:0;b[9]=Number($('brightness').value);b[10]=Number($('speed').value);b[11]=Number($('direction').value);dirty('lighting');syncLighting();}
['lightColor','multicolor','brightness','speed','direction'].forEach(id=>$(id).oninput=editLighting);
['#b6a0f3','#fd93b3','#edb881','#b9dda8','#8ad9d4','#91b7f2','#ffffff','#000000'].forEach(color=>{const b=document.createElement('button');b.style.background=color;b.title=color;b.setAttribute('aria-label',color);b.onclick=()=>$('paintColor').value=color;$('swatches').append(b);});
function paintAll(color){for(const k of keys)state.blocks.colors.set([k.light,...color],k.light*4);dirty('colors');}
$('paintAll').onclick=()=>paintAll(rgb($('paintColor').value));$('clearColors').onclick=()=>paintAll([0,0,0]);$('customBrightness').oninput=()=>dirty('colors');
function syncSettings(){const b=state.blocks.settings;for(const [id,checked] of Object.entries(readShortcutLocks(b)))$(id).checked=checked;$('fnSwitch').value=b[5];$('sleepTime').value=b[6];$('responseTime').value=b[8];}
function editSettings(){const b=writeShortcutLocks(state.blocks.settings,{disableWin:$('disableWin').checked,disableAltF4:$('disableAltF4').checked,disableAltTab:$('disableAltTab').checked});state.blocks.settings=b;b[1]=1;b[5]=Number($('fnSwitch').value);b[6]=Number($('sleepTime').value);b[8]=Number($('responseTime').value);dirty('settings');}
['disableWin','disableAltF4','disableAltTab','fnSwitch','sleepTime','responseTime'].forEach(id=>$(id).onchange=editSettings);
$('resetKeys').onclick=()=>{state.blocks.keys.fill(0);state.blocks.fn.fill(0);dirty('keys');dirty('fn');readKeyEditor();toast('两层映射已恢复默认，正在自动应用');};
function persistConfirmed(){
 if(!state.confirmed)return;
 const profile={format:'galaxy80-webhid',version:1,product:'Galaxy80',created:new Date().toISOString(),blocks:Object.fromEntries(Object.entries(state.confirmed).map(([k,v])=>[k,hex(v)]))};
 try{localStorage.setItem('galaxy80-last-confirmed',JSON.stringify(profile));}catch{toast('浏览器未能保存配置记录，请导出备份');}
}
async function wirelessBaseline(){
 let cached=null,seed=null;
 try{cached=JSON.parse(localStorage.getItem('galaxy80-last-confirmed'));if(cached)validateProfile(cached);}catch{cached=null;}
 try{const r=await fetch('./device-baseline.json');if(r.ok){seed=await r.json();validateProfile(seed);}}catch{seed=null;}
 const latest=[cached,seed].filter(Boolean).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created))[0];
 if(!latest)throw Error('无线不能读取整套配置，请先通过有线连接读取一次，再切回 2.4G');
 return validateProfile(latest);
}
async function loadDevice(connecting=false){
 if(state.dirty.size&&!connecting)throw Error('仍有修改尚未应用，请等待完成或先导出配置');
 const pending=connecting?new Map([...state.dirty].map(name=>[name,name==='macros'?compileMacroBank(state.macros):state.blocks[name].slice()])):new Map();
 const wireless=!!state.hid.wireless;let blocks;
 if(wireless){notice('正在连接 2.4G 键盘…');blocks=await wirelessBaseline();await state.hid.initialize();}
 else{notice('正在读取键盘配置，请保持连接…');blocks=await state.hid.readAll();}
 state.blocks=blocks;state.backup=copyBlocks(blocks);state.confirmed=copyBlocks(blocks);if(!wireless)persistConfirmed();
 state.dirty.clear();autoApply.clear();for(const [name,data] of pending){state.blocks[name]=data;state.dirty.add(name);autoApply.mark(name);}parseMacros();syncAll();
 notice(wireless?'已连接 2.4G。已载入最近备份和网页确认的修改；更改会自动应用。无线不支持完整配置读回。':'已读取设备配置并保留原始备份。修改后会自动应用，无需再次保存。','success');
 const d=state.hid.device;$('deviceInfo').replaceChildren();
 for(const [label,value] of [['设备',d.productName],['连接方式',wireless?'2.4G · WebHID':'USB · WebHID'],['设备标识','05AC : 024F'],['配置接口',wireless?'FF60 / 61 · 32 bytes':'FF13 / 01 · 64 bytes'],['配置来源',wireless?'最近备份及本网页已确认的修改':'全部配置块读取校验通过'],...(wireless?[['连接时电量',`${state.hid.battery}%`]]:[])]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('deviceInfo').append(dt,dd);}
}
$('connect').onclick=()=>{
 if(!navigator.hid){notice('此浏览器没有 WebHID，请使用桌面 Chrome 或 Edge 打开 http://127.0.0.1:8080','error');return;}
 // Invoke the permission picker directly during the click's user activation.
 const request=navigator.hid.requestDevice({filters:[{vendorId:0x05ac,productId:0x024f,usagePage:0xff13,usage:1},{vendorId:0x05ac,productId:0x024f,usagePage:0xff60,usage:0x61}]});
 work(async()=>{const devices=await request;if(!devices.length){toast('未选择设备');return;}const d=devices.find(d=>d.productName==='Galaxy80')||devices.find(d=>{try{validateWireless(d);return true;}catch{return false;}});if(!d)throw Error('请选择 Galaxy80 或 Galaxy80-2.4g 的配置接口');const hid=d.productName==='Galaxy80-2.4g'?new WirelessHID(d,log):new GalaxyHID(d,log);await d.open();state.hid=hid;try{await loadDevice(true);}catch(e){hid.dispose?.();await d.close();state.hid=null;throw e;}});
};
$('disconnect').onclick=()=>work(async()=>{await stopRealtime();state.hid?.dispose?.();await state.hid?.device.close();state.hid=null;state.backup=null;notice('已断开键盘。草稿仍保留在页面中。');});
$('readDevice').onclick=()=>work(loadDevice);
navigator.hid?.addEventListener('disconnect',e=>{if(e.device===state.hid?.device){state.running=false;releaseMedia();state.hid?.dispose?.();state.hid=null;state.backup=null;notice('键盘已断开，草稿仍保留。重新连接后可再次读取。','error');refreshStatus();}});
async function saveBlock(name,isCurrent=()=>true){
 hasDevice();const snapshot=state.blocks[name].slice();
 const readback=await state.hid.writeBlock(name,snapshot);
 state.confirmed[name]=readback.slice();persistConfirmed();
 if(isCurrent()){state.blocks[name]=readback;state.dirty.delete(name);}
 refreshStatus();
}
$('save').onclick=()=>autoApply.flush();
function parseMacros(){try{state.macros=parseMacroBank(state.blocks.macros);state.macroParsed=true;}catch(e){state.macros=[];state.macroParsed=false;toast(e.message);}state.macroSlot=state.macros.findIndex(Boolean);if(state.macroSlot<0)state.macroSlot=0;}
function renderMacros(){
 const list=$('macroList');list.replaceChildren();state.macros.forEach((m,i)=>{if(!m)return;const b=document.createElement('button');b.className='macro-item'+(state.macroSlot===i?' active':'');b.style.width='100%';const title=document.createElement('strong'),sub=document.createElement('span');title.textContent=m.name;sub.textContent=`${m.events.length} 个动作`;b.append(title,sub);b.onclick=()=>{if(state.recording)return;state.macroSlot=i;renderMacros();};list.append(b);});
 if(!list.children.length)list.textContent=state.macroParsed?'还没有宏。创建一个开始录制。':'设备宏格式未识别，原始数据已保留。';
 const m=state.macros[state.macroSlot];$('macroName').value=m?.name||'';$('recordMacro').disabled=!m||state.recording;$('deleteMacro').disabled=!m||state.recording;$('addMacroEvent').disabled=!m||state.recording;
 $('macroEvents').replaceChildren();
 m?.events.forEach((e,i)=>{const row=document.createElement('div');row.className='macro-event';const type=document.createElement('select'),code=document.createElement('select'),time=document.createElement('input'),del=document.createElement('button');fillSelect(type,[['down','按下'],['up','释放'],['mouseDown','鼠标按下'],['mouseUp','鼠标释放']]);type.value=e.type;type.ariaLabel='动作类型';fillSelect(code,e.type.startsWith('mouse')?[[1,'左键'],[2,'右键'],[4,'中键']]:keys.map(k=>[k.code,k.name]));code.value=e.code;code.ariaLabel='动作按键';time.type='number';time.min=10;time.max=65535;time.value=e.delay;time.ariaLabel='之后延迟毫秒';del.textContent='×';del.ariaLabel='删除动作';type.onchange=()=>{e.type=type.value;e.code=e.type.startsWith('mouse')?1:4;macroChanged();};code.onchange=()=>{e.code=Number(code.value);macroChanged();};time.onchange=()=>{e.delay=Math.max(10,Math.min(65535,Number(time.value)||10));macroChanged();};del.onclick=()=>{m.events.splice(i,1);macroChanged();};row.append(type,code,time,del);$('macroEvents').append(row);});
 const count=state.macros.reduce((n,m)=>n+(m?8+m.events.length*8:0),0);$('macroStorage').textContent=`动作区 ${count} / 2670 字节 · 最多 100 个宏`;
}
function macroChanged(){dirty('macros');renderMacros();fillActionOptions();}
$('addMacro').onclick=()=>{if(!state.macroParsed){toast('设备宏未识别，禁止覆盖');return;}let slot=0;while(state.macros[slot])slot++;if(slot>=100){toast('宏已满');return;}state.macros[slot]={name:'宏 '+(slot+1),events:[]};state.macroSlot=slot;macroChanged();};
$('macroName').onchange=()=>{const m=state.macros[state.macroSlot];if(m){m.name=$('macroName').value.slice(0,60)||'未命名宏';macroChanged();}};
$('deleteMacro').onclick=()=>{for(const name of ['keys','fn']){const b=state.blocks[name];keys.forEach(k=>{const p=k.index*4;if(b[p]===6&&b[p+1]===state.macroSlot){b.fill(0,p,p+4);dirty(name);}});}delete state.macros[state.macroSlot];macroChanged();};
$('addMacroEvent').onclick=()=>{const m=state.macros[state.macroSlot];if(m){m.events.push({type:'down',code:4,delay:50},{type:'up',code:4,delay:50});macroChanged();}};
let lastRecorded=0;
function recordEvent(type,code){const m=state.macros[state.macroSlot];const now=performance.now();if(m.events.length)m.events.at(-1).delay=Math.min(65535,Math.max(10,Math.round(now-lastRecorded)));m.events.push({type,code,delay:50});lastRecorded=now;dirty('macros');renderMacros();if(m.events.length>320)stopRecord();}
function stopRecord(){if(!state.recording)return;for(const code of state.recordedPressed.values())recordEvent('up',code);state.recordedPressed.clear();state.recording=false;$('stopRecord').disabled=true;renderMacros();autoApply.schedule();toast('录制已停止，正在自动应用');}
$('recordMacro').onclick=()=>{state.recording=true;lastRecorded=performance.now();state.recordedPressed.clear();$('stopRecord').disabled=false;renderMacros();notice('正在录制键盘动作。按 Esc 或点击停止录制结束。');};$('stopRecord').onclick=stopRecord;
document.addEventListener('keydown',e=>{const code=browserCodes[e.code];if(state.recording){e.preventDefault();if(e.code==='Escape'){stopRecord();return;}if(code&&!e.repeat&&!state.recordedPressed.has(e.code)){state.recordedPressed.set(e.code,code);recordEvent('down',code);}}document.querySelectorAll(`.key[data-code="${code}"]`).forEach(k=>k.classList.add('pressed'));});
document.addEventListener('keyup',e=>{const code=browserCodes[e.code];if(state.recording&&state.recordedPressed.has(e.code)){e.preventDefault();recordEvent('up',code);state.recordedPressed.delete(e.code);}document.querySelectorAll(`.key[data-code="${code}"]`).forEach(k=>k.classList.remove('pressed'));});
window.addEventListener('blur',stopRecord);
function profile(){return {format:'galaxy80-webhid',version:1,product:'Galaxy80',name:$('profileName').value.slice(0,80),created:new Date().toISOString(),blocks:Object.fromEntries(Object.entries(state.blocks).map(([k,v])=>[k,hex(k==='macros'&&state.dirty.has('macros')?compileMacroBank(state.macros):v)])),macroNames:state.macros.map(m=>m?.name||null)};}
function download(name,data,type='application/json'){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('exportProfile').onclick=()=>{try{download('Galaxy80-配置.json',profile());}catch(e){toast(e.message);}};
$('exportBackup').onclick=()=>{if(!state.backup){toast('请先读取键盘');return;}download('Galaxy80-原始备份.json',{format:'galaxy80-webhid',version:1,product:'Galaxy80',created:new Date().toISOString(),blocks:Object.fromEntries(Object.entries(state.backup).map(([k,v])=>[k,hex(v)]))});};
function importObject(p){state.blocks=validateProfile(p);parseMacros();if(Array.isArray(p.macroNames))state.macros.forEach((m,i)=>{if(m&&typeof p.macroNames[i]==='string')m.name=p.macroNames[i].slice(0,60);});if(typeof p.name==='string')$('profileName').value=p.name.slice(0,80);state.dirty=new Set(Object.keys(BLOCKS));for(const name of state.dirty)autoApply.mark(name);syncAll();toast('配置已加载，连接状态下会自动应用');}
function importXML(text){const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror')||xml.documentElement.tagName!=='profile')throw Error('不是 VTER 按键配置 XML');const next=copyBlocks(state.blocks);let count=0;for(const item of xml.querySelectorAll('keyitems > item')){const a=n=>Number(item.getAttribute(n));const k=keys.find(k=>k.code===a('key_code'));if(!k)throw Error('配置包含不属于 Galaxy80 的按键');const layer=a('fn_layer')?'fn':'keys';const type=a('macro_type'),value=a('macro_value');let action;if(type===0)action=keyAction('default');else if(type===1)action=keyAction('disabled');else if(type===2)action=keyAction('key',value,a('macro_value2'));else if(type===6)action=keyAction('media',[0,0xcd,0xb7,0xb6,0xb5,0xe9,0xea,0xe2][value]);else if(type===12){const map=[0x194,0x192,0x18a,0x183,0xcd,0xb7,0xb6,0xb5,0xe9,0xea,0xe2,0x223,0x227,0x226,0x224,0x225,0x22a,0x221];if(value<500||value>517)throw Error('XML 多媒体参数无效');action=keyAction('media',map[value-500]);}else throw Error('此 XML 含有尚未支持的桌面动作或宏引用，未导入');next[layer]=applyKey(next[layer],k.index,action);count++;}if(!count)throw Error('XML 中没有按键配置');state.blocks=next;dirty('keys');dirty('fn');syncAll();toast(`已导入 ${count} 项按键配置`);}
$('importProfile').onchange=()=>work(async()=>{const f=$('importProfile').files[0];if(!f)return;if(f.size>200000)throw Error('配置文件过大');const text=await f.text();if(f.name.toLowerCase().endsWith('.xml'))importXML(text);else importObject(JSON.parse(text));$('importProfile').value='';});
$('applyProfile').onclick=()=>{for(const name of state.dirty)autoApply.mark(name);autoApply.flush();};
function localProfiles(){try{return JSON.parse(localStorage.getItem('galaxy80-profiles')||'[]');}catch{return [];}}
function renderLocalProfiles(){const box=$('localProfiles');box.replaceChildren();localProfiles().forEach((p,i)=>{const row=document.createElement('div');row.className='local-profile';const name=document.createElement('span');name.textContent=p.name||'未命名方案';const open=document.createElement('button'),del=document.createElement('button');open.textContent='加载';del.textContent='删除';open.onclick=()=>{try{importObject(p);}catch(e){toast(e.message);}};del.onclick=()=>{const all=localProfiles();all.splice(i,1);localStorage.setItem('galaxy80-profiles',JSON.stringify(all));renderLocalProfiles();};row.append(name,open,del);box.append(row);});}
$('saveLocal').onclick=()=>{try{const all=localProfiles();const p=profile();const i=all.findIndex(a=>a.name===p.name);if(i>=0)all[i]=p;else all.push(p);localStorage.setItem('galaxy80-profiles',JSON.stringify(all));renderLocalProfiles();toast('已保存到此浏览器');}catch(e){toast(e.message);}};
$('exportLog').onclick=()=>download('Galaxy80-通信记录.json',state.logs);$('clearLog').onclick=()=>{state.logs=[];$('log').textContent='记录已清空';};
$('firmwareFile').onchange=()=>work(async()=>{const file=$('firmwareFile').files[0];if(!file)return;if(file.size>2000000)throw Error('文件过大');const text=await file.text();let upper=0,total=0,min=Infinity,max=0,eof=false;const seen=new Set();for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line)continue;if(eof)throw Error('结束记录后仍有数据');if(!/^:[\da-f]+$/i.test(line))throw Error('Intel HEX 记录格式错误');const b=fromHex(line.slice(1));if(b.length!==b[0]+5||b.reduce((n,v)=>n+v,0)%256)throw Error('Intel HEX 校验失败');const addr=b[1]*256+b[2];if(b[3]===4){if(b[0]!==2)throw Error('扩展地址格式错误');upper=(b[4]*256+b[5])*65536;}else if(b[3]===2){if(b[0]!==2)throw Error('段地址格式错误');upper=(b[4]*256+b[5])*16;}else if(b[3]===0){for(let i=0;i<b[0];i++){const a=upper+addr+i;if(seen.has(a))throw Error('固件地址重叠');seen.add(a);min=Math.min(min,a);max=Math.max(max,a);}total+=b[0];}else if(b[3]===1){if(b[0]!==0)throw Error('结束记录格式错误');eof=true;}else if(![3,5].includes(b[3]))throw Error('未知 HEX 记录类型');}if(!eof||!total)throw Error('缺少有效数据或结束记录');const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())));$('firmwareInfo').textContent=`${file.name}\n记录校验：通过\n数据：${total} bytes\n地址：0x${min.toString(16)} – 0x${max.toString(16)}\n文件 SHA-256：${digest}\n未写入键盘`;});
let audioUrl=null;
$('audioFile').onchange=()=>{if(audioUrl)URL.revokeObjectURL(audioUrl);const f=$('audioFile').files[0];if(f){audioUrl=URL.createObjectURL(f);$('audioPlayer').src=audioUrl;}};
let video=null,analyser=null,audioNode=null;
async function releaseMedia(){state.media.forEach(s=>s.getTracks().forEach(t=>t.stop()));state.media=[];if(video){video.srcObject=null;video=null;}$('audioPlayer').pause();if(state.audioContext)await state.audioContext.suspend();analyser=null;}
async function stopRealtime(){const wasRunning=state.running;state.running=false;await releaseMedia();for(let i=0;state.hid?.busy&&i<100;i++)await delay(20);if(wasRunning&&state.hid?.device.opened&&!state.hid.faulted)await state.hid.stopRealtime();$('startRealtime').disabled=false;$('stopRealtime').disabled=true;$('realtimeStatus').textContent='已停止，恢复板载效果';refreshStatus();}
$('stopRealtime').onclick=()=>work(stopRealtime);
const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;const ctx=canvas.getContext('2d',{willReadFrequently:true});
function hsv(h,s,v){const f=n=>{const k=(n+h*6)%6;return Math.round(v*255*(1-s*Math.max(0,Math.min(k,4-k,1))));};return [f(5),f(3),f(1)];}
$('startRealtime').onclick=()=>work(async()=>{
 hasDevice();if(state.hid.wireless)throw Error('此实时效果请使用 USB 有线连接');if(state.dirty.size)throw Error('请等待修改自动应用完成，再启动实时效果');const mode=$('realtimeMode').value;
 try{
 if(mode==='screen'||(mode==='audio'&&$('audioSource').value==='system')){const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:mode==='audio'});state.media.push(stream);if(mode==='screen'){video=document.createElement('video');video.srcObject=stream;await video.play();}else if(!stream.getAudioTracks().length)throw Error('未共享音频，请重新选择并勾选共享音频');stream.getVideoTracks()[0].onended=()=>{stopRealtime().catch(e=>notice(e.message,'error'));};}
 if(mode==='audio'){
  state.audioContext??=new AudioContext();await state.audioContext.resume();analyser=state.audioContext.createAnalyser();analyser.fftSize=256;
  if($('audioSource').value==='file'){if(!audioUrl)throw Error('请先选择音频文件');audioNode??=state.audioContext.createMediaElementSource($('audioPlayer'));audioNode.disconnect();audioNode.connect(analyser);analyser.connect(state.audioContext.destination);await $('audioPlayer').play();}
  else{if($('audioSource').value==='microphone')state.media.push(await navigator.mediaDevices.getUserMedia({audio:true}));state.audioContext.createMediaStreamSource(state.media.at(-1)).connect(analyser);}
 }
 state.running=true;state.frameCount=0;$('startRealtime').disabled=true;$('stopRealtime').disabled=false;refreshStatus();runFrames(mode);
 }catch(e){await releaseMedia();throw e;}
});
async function runFrames(mode){
 const bins=new Uint8Array(128);
 try{while(state.running&&state.hid?.device.opened){const start=performance.now(),t=start/1000,intensity=Number($('intensity').value)/100,base=rgb($('realtimeColor').value);let average=base;
  if(mode==='screen'&&video?.readyState>=2){ctx.drawImage(video,0,0,16,9);const data=ctx.getImageData(0,0,16,9).data;average=[0,0,0];for(let i=0;i<data.length;i+=4)for(let j=0;j<3;j++)average[j]+=data[i+j]/144;}
  if(mode==='audio')analyser?.getByteFrequencyData(bins);
  const records=keys.map(k=>{const x=Number(k.rect_left)/760,y=Number(k.rect_top)/270;let color=base,scale=intensity;if(mode==='wave')color=hsv((x+t*.12)%1,.7,1);if(mode==='breath')scale*=.15+.85*(Math.sin(t*2)+1)/2;if(mode==='stars')scale*=Math.pow(Math.max(0,Math.sin(k.index*17+t*1.3)),15);if(mode==='screen')color=average;if(mode==='audio'){const level=bins[Math.floor(x*45)]/255;scale*=1-y<level?level:.02;color=hsv(x*.75,.7,1);}return [k.light,...color.map(v=>Math.round(v*scale))];});
  await state.hid.frame(records);state.frameCount++;$('realtimeStatus').textContent=`运行中 · 已发送 ${state.frameCount} 帧`;
  records.forEach(r=>{const b=document.querySelector(`.key[data-index="${r[0]}"]`);if(b){b.classList.add('colored');b.style.setProperty('--key-color',`rgb(${r.slice(1).join(',')})`);}});await delay(Math.max(0,160-(performance.now()-start)));
 }}catch(e){notice('实时效果已停止：'+e.message,'error');}finally{state.running=false;await releaseMedia();$('startRealtime').disabled=false;$('stopRealtime').disabled=true;refreshStatus();}
}
window.addEventListener('beforeunload',e=>{state.running=false;state.media.forEach(s=>s.getTracks().forEach(t=>t.stop()));});
function syncAll(){renderKeyboard();readKeyEditor();syncLighting();syncSettings();renderMacros();renderLocalProfiles();refreshStatus();}
syncAll();setView(location.hash.slice(1)||'keys');if(!navigator.hid)notice('当前浏览器未提供 WebHID。可离线编辑；连接设备请在桌面 Chrome 或 Edge 打开本页。');
