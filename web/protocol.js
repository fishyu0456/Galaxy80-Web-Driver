// Packet formats recovered from the installed VTER Driver and SN32F240.hex.
// See research/PROTOCOL.md for addresses, evidence and verification limits.
export const BLOCKS=Object.freeze({
 lighting:{read:0x12,write:0x13,pages:1,marker:14},
 settings:{read:0x16,write:0x17,pages:1,marker:62},
 keys:{read:0x10,write:0x11,pages:9,marker:574},
 fn:{read:0x26,write:0x27,pages:9,marker:574},
 colors:{read:0x22,write:0x23,pages:9,marker:574},
 macros:{read:0x14,write:0x15,pages:48,marker:3070}
});
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export const sum=b=>b.reduce((a,v)=>(a+v)>>>0,0);
export const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
// Firmware 0x3b94 packs bytes 2/3/4 into runtime bits 5/6/7.
// 0x3040 checks bit 5 for Tab, 0x3054 bit 6 for F4, 0x2f40 bit 7 for GUI.
export const SHORTCUT_OFFSETS=Object.freeze({disableWin:4,disableAltF4:3,disableAltTab:2});
export function readShortcutLocks(bytes){return Object.fromEntries(Object.entries(SHORTCUT_OFFSETS).map(([name,offset])=>[name,!!bytes[offset]]));}
export function writeShortcutLocks(bytes,locks){
 const out=bytes.slice();
 for(const [name,offset] of Object.entries(SHORTCUT_OFFSETS))out[offset]=locks[name]?1:0;
 return out;
}
export function fromHex(s){if(typeof s!=='string'||s.length%2||!/^[\da-f]*$/i.test(s))throw Error('配置数据格式无效');return Uint8Array.from(s.match(/../g)||[],v=>parseInt(v,16));}
export function packet(op,count=0){const b=new Uint8Array(64);b[0]=4;b[1]=op;b[8]=count&255;b[9]=count>>>8;return b;}
export function normalizeReport(view){
 const b=new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
 if(b.length===64)return b.slice();
 if(b.length===65&&b[0]===0)return b.slice(1);
 throw Error(`设备返回长度异常（${b.length} 字节）`);
}
export function validateDevice(d){
 if(d.vendorId!==0x05ac||d.productId!==0x024f||d.productName!=='Galaxy80')throw Error('当前版本仅适配 Galaxy80 有线模式');
 const c=d.collections.find(c=>c.usagePage===0xff13&&c.usage===1);
 const report=c?.featureReports.find(r=>r.reportId===0&&r.items.reduce((s,i)=>s+i.reportSize*i.reportCount,0)===512);
 if(!report)throw Error('未找到已验证的 64 字节厂商接口，请使用 USB 有线模式');
}
export class GalaxyHID {
 constructor(device,log=()=>{}){validateDevice(device);this.device=device;this.log=log;this.busy=false;this.faulted=false;}
 async transaction(fn){
  if(this.busy)throw Error('键盘正在通信，请稍候');
  if(this.faulted)throw Error('上次通信中断，请重新插拔键盘后重新连接');
  if(!this.device.opened)throw Error('键盘已断开');
  this.busy=true;
  try{return await fn();}catch(e){this.faulted=true;throw e;}finally{this.busy=false;}
 }
 async send(b,ms=40){if(b.length!==64)throw Error('数据包必须为 64 字节');await this.device.sendFeatureReport(0,b);this.log('发送',b);await delay(ms);}
 async receive(ms=40){const b=normalizeReport(await this.device.receiveFeatureReport(0));this.log('接收',b);await delay(ms);return b;}
 async command(op,count=0){
  await this.send(packet(op,count));let b=await this.receive();
  // Retry reads only. Re-sending a command during a write can corrupt a block.
  for(let i=0;i<3&&b[0]===4&&b[1]===op&&b[3]===0;i++)b=await this.receive();
  if(b[0]!==4||b[1]!==op||b[3]!==1)throw Error(`键盘未确认指令 ${op.toString(16)}，已停止后续写入`);
  return b;
 }
 async readBlock(name){
  const spec=BLOCKS[name];if(!spec)throw Error('未知配置块');
  // Read length is the final page index, unlike write length (page count).
  await this.send(packet(spec.read,spec.pages-1));
  const first=await this.receive();const data=new Uint8Array(spec.pages*64);let start=0;
  if(first[0]===4&&first[1]===spec.read&&first[3]===1){/* explicit ACK */}
  else if(first[0]===4&&first[1]===spec.read&&(first[3]===255||first[3]===0))throw Error('键盘拒绝读取配置');
  else{data.set(first);start=1;}
  for(let i=start;i<spec.pages;i++)data.set(await this.receive(),i*64);
  const end=await this.command(2);const expected=new DataView(end.buffer,end.byteOffset).getUint32(4,true);
  if(expected!==sum(data))throw Error(`读取 ${name} 校验失败，请重新连接（${sum(data)} / ${expected}）`);
  return data;
 }
 async readAll(){return this.transaction(async()=>{const out={};for(const name of Object.keys(BLOCKS))out[name]=await this.readBlock(name);return out;});}
 async writeBlock(name,input){
  const spec=BLOCKS[name];if(!spec||input.length!==spec.pages*64)throw Error('配置块长度错误');
  const data=input.slice();data[spec.marker]=0xaa;data[spec.marker+1]=0x55;
  return this.transaction(async()=>{
   await this.command(name==='macros'?0x19:0x18);
   const select=packet(spec.write,spec.pages);if(name==='settings')select[2]=1;
   await this.send(select);const ack=await this.receive();
   if(ack[0]!==4||ack[1]!==spec.write||ack[3]!==1)throw Error('设备未进入写入状态，未发送配置数据');
   for(let i=0;i<data.length;i+=64)await this.send(data.slice(i,i+64));
   const end=await this.command(2);
   if(new DataView(end.buffer,end.byteOffset).getUint32(4,true)!==sum(data))throw Error('设备保存校验失败，请恢复备份');
   // The desktop settings transaction ends at 04 02; F0 is for lighting/key reload.
   if(name!=='macros'&&name!=='settings')await this.command(0xf0);
   const readback=await this.readBlock(name);
   if(!data.every((v,i)=>v===readback[i]))throw Error('保存后的读回数据不一致，请恢复备份');
   return readback;
  });
 }
 async frame(records){
  if(records.length>128)throw Error('实时颜色最多 128 个按键');
  return this.transaction(async()=>{
   await this.command(0x20,8);
   const data=new Uint8Array(512);records.forEach((r,i)=>data.set(r,i*4));
   for(let i=0;i<512;i+=64)await this.send(data.slice(i,i+64),3);
   await this.command(2);
  });
 }
 async stopRealtime(){return this.transaction(()=>this.command(0xf0));}
}
export function keyAction(type,value=0,mod=0,extra=0){
 if(!Number.isInteger(value)||value<0||value>65535)throw Error('无效按键值');
 switch(type){
  case 'default':return [0,0,0,0];case 'disabled':return [5,3,0,0];
  case 'key':if(value>255)throw Error('无效按键值');return value>=224&&value<=231?[2,mod|(1<<(value-224)),0,0]:[2,mod,value,0];
  case 'media':return [3,value&255,value>>>8,0];
  case 'mouse':return [1,1,value&255,0];
  case 'macro':if(value>99||mod<0||mod>3||extra<1||extra>255)throw Error('宏绑定参数无效');return [6,value,mod,extra];
  case 'multi':if(value>255||mod>255||extra>255)throw Error('无效组合键');return [7,value,mod,extra];
  default:throw Error('不支持的按键类型');
 }
}
export function applyKey(block,index,action){if(!Number.isInteger(index)||index<1||index>142||action.length!==4)throw Error('无效按键索引');const b=block.slice();b.set(action,index*4);return b;}
export function compileMacroBank(macros){
 if(!Array.isArray(macros)||macros.length>100)throw Error('最多 100 个宏');
 const b=new Uint8Array(3072);let cursor=400;const dv=new DataView(b.buffer);
 for(let slot=0;slot<100;slot++){
  const macro=macros[slot];if(!macro?.events?.length){dv.setUint32(slot*4,0xffffffff,true);continue;}
  const events=macro.events;
  if(cursor+8+events.length*8>3070)throw Error('宏存储空间不足');
  dv.setUint16(slot*4,cursor,true);dv.setUint16(cursor,events.length*2,true);
  let p=cursor+8;
  for(const event of events){
   if(!['down','up','mouseDown','mouseUp'].includes(event.type)||!Number.isInteger(event.code)||event.code<1||event.code>255||!Number.isInteger(event.delay)||event.delay<0||event.delay>65535)throw Error('宏动作格式错误');
   b[p+2]=event.code;b[p+3]=({down:0xb0,up:0x30,mouseDown:0x90,mouseUp:0x10})[event.type];p+=4;
   dv.setUint16(p,Math.max(10,event.delay),true);b[p+3]=0x50;p+=4;
  }
  cursor=p;
 }
 b[3070]=0xaa;b[3071]=0x55;return b;
}
export function parseMacroBank(b){
 if(b.length!==3072)throw Error('宏存储长度错误');
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);const out=[];
 for(let slot=0;slot<100;slot++){
  const p=dv.getUint32(slot*4,true);if(p===0||p===0xffffffff)continue;
  if(p<400||p+8>3070)throw Error('已有宏格式未识别，已保留原始备份');
  const n=dv.getUint16(p,true);if(n%2||p+8+n*4>3070)throw Error('已有宏格式未识别');
  const events=[];
  for(let j=0;j<n;j+=2){const a=p+8+j*4;const type=({176:'down',48:'up',144:'mouseDown',16:'mouseUp'})[b[a+3]];if(!type||b[a+7]!==80)throw Error('已有宏包含未支持动作');events.push({type,code:b[a+2],delay:dv.getUint16(a+4,true)});}
  out[slot]={name:`宏 ${slot+1}`,events};
 }return out;
}
export function validateProfile(p){
 if(!p||p.format!=='galaxy80-webhid'||p.version!==1||p.product!=='Galaxy80')throw Error('不是 Galaxy80 配置文件');
 const out={};for(const [name,spec] of Object.entries(BLOCKS)){out[name]=fromHex(p.blocks?.[name]);if(out[name].length!==spec.pages*64)throw Error(`${name} 配置长度错误`);}
 return out;
}
