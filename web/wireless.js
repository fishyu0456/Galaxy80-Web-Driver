import {BLOCKS,delay,sum,parseMacroBank} from './protocol.js';

export function validateWireless(d){
 if(d.vendorId!==0x05ac||d.productId!==0x024f||d.productName!=='Galaxy80-2.4g')throw Error('请选择 Galaxy80 2.4G 接收器');
 const bits=r=>r.items.reduce((n,i)=>n+i.reportSize*i.reportCount,0);
 const collection=d.collections.find(c=>c.usagePage===0xff60&&c.usage===0x61&&c.outputReports.some(r=>r.reportId===0&&bits(r)===256)&&c.inputReports.some(r=>r.reportId===0&&bits(r)===256));
 if(!collection)throw Error('请选择 32 字节的无线配置接口');
}
export function wirelessPacket(op,length,index=0,data=new Uint8Array()){
 if(data.length>28||length>28||index>255)throw Error('无线数据包长度或序号无效');
 const b=new Uint8Array(32);b.set([op,length,index]);b.set(data,3);b[31]=sum(b.slice(0,31))&255;return b;
}
export function wirelessBlockPackets(name,input){
 const spec=BLOCKS[name];if(!spec||input.length!==spec.pages*64)throw Error('配置块长度错误');
 const data=input.slice();data[spec.marker]=170;data[spec.marker+1]=85;
 if(name==='settings'||name==='lighting'){
  const payload=data.slice(0,28);payload[14]=170;payload[15]=85;
  return [wirelessPacket(name==='settings'?7:5,16,0,payload)];
 }
 const opcode={keys:0x10,fn:0x12,colors:0x14,macros:9}[name];
 if(name==='macros'){
  parseMacroBank(data);const dv=new DataView(data.buffer);let used=400;
  for(let slot=0;slot<100;slot++){const offset=dv.getUint32(slot*4,true);if(offset&&offset!==0xffffffff)used=Math.max(used,offset+8+dv.getUint16(offset,true)*4);}
  // Desktop 0x42e218: ceil(used/28) + one marker page, not the full USB bank.
  const padded=new Uint8Array((Math.ceil(used/28)+1)*28);padded.set(data.slice(0,used));padded[padded.length-2]=170;padded[padded.length-1]=85;
  return Array.from({length:padded.length/28},(_,i)=>wirelessPacket(opcode,i===padded.length/28-1?used%28:28,i,padded.slice(i*28,i*28+28)));
 }
 // Receiver firmware programs full 28-byte chunks, including the last one.
 const padded=new Uint8Array(Math.ceil(data.length/28)*28);padded.set(data);
 return Array.from({length:padded.length/28},(_,i)=>wirelessPacket(opcode,Math.min(28,data.length-i*28),i,padded.slice(i*28,i*28+28)));
}
export class WirelessHID{
 constructor(device,log=()=>{}){
  validateWireless(device);this.device=device;this.log=log;this.busy=false;this.faulted=false;this.wireless=true;this.pending=null;this.battery=null;
  this.listener=e=>{
   if(e.reportId!==0||e.data.byteLength!==32)return;
   const b=new Uint8Array(e.data.buffer,e.data.byteOffset,e.data.byteLength).slice();this.log('接收',b);
   const p=this.pending;if(!p||!p.header.every((v,i)=>b[i]===v))return;
   if((sum(b.slice(0,31))&255)!==b[31]){p.reject(Error('无线回复校验失败'));return;}
   p.resolve(b);
  };
  device.addEventListener('inputreport',this.listener);
 }
 dispose(){this.device.removeEventListener('inputreport',this.listener);this.pending?.reject(Error('无线连接已断开'));}
 async transaction(fn){
  if(this.busy)throw Error('键盘正在通信');if(this.faulted)throw Error('无线通信中断，请唤醒键盘后重新连接');if(!this.device.opened)throw Error('接收器已断开');
  this.busy=true;try{return await fn();}catch(e){this.faulted=true;throw e;}finally{this.busy=false;}
 }
 async exchange(packet){
  let timer;
  const reply=new Promise((resolve,reject)=>{this.pending={header:packet.slice(0,3),resolve,reject};timer=setTimeout(()=>reject(Error('键盘没有回复，请确认处于 2.4G 模式并按键唤醒')),1800);});
  // Attach rejection handling before sendReport; a disconnect can race the send.
  const sent=(async()=>{this.log('发送',packet);await this.device.sendReport(0,packet);})();
  try{const [,result]=await Promise.all([sent,reply]);await delay(15);return result;}
  finally{clearTimeout(timer);this.pending=null;}
 }
 async initialize(){return this.transaction(async()=>{this.info=await this.exchange(wirelessPacket(2,0));const battery=await this.exchange(wirelessPacket(0x20,1));this.battery=Math.min(100,battery[3]);});}
 async writeBlock(name,input){
  const packets=wirelessBlockPackets(name,input);
  return this.transaction(async()=>{for(const packet of packets)await this.exchange(packet);const data=input.slice();const marker=BLOCKS[name].marker;data[marker]=170;data[marker+1]=85;return data;});
 }
}
