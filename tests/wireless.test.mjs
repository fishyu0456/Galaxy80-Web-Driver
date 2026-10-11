import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wirelessPacket,wirelessBlockPackets,WirelessHID,validateWireless} from '../web/wireless.js';
import {compileMacroBank,writeShortcutLocks} from '../web/protocol.js';
function device(bits=256){return {vendorId:0x05ac,productId:0x024f,productName:'Galaxy80-2.4g',opened:true,collections:[{usagePage:0xff60,usage:0x61,inputReports:[{reportId:0,items:[{reportCount:bits/8,reportSize:8}]}],outputReports:[{reportId:0,items:[{reportCount:bits/8,reportSize:8}]}]}],addEventListener(type,fn){this.listener=fn;},removeEventListener(){},async sendReport(id,b){this.sent=[id,b];const reply=wirelessPacket(...b.slice(0,3));queueMicrotask(()=>this.listener({reportId:0,data:new DataView(reply.buffer)}));}};}
test('receiver discovery accepts 32-byte interface and rejects its 64-byte sibling',()=>{validateWireless(device());assert.throws(()=>validateWireless(device(512)));});
test('wireless settings preserve each shortcut position and use the wireless marker',()=>{
 for(const [name,offset] of [['disableWin',4],['disableAltTab',2],['disableAltF4',3]]){
  const b=writeShortcutLocks(new Uint8Array(64),{[name]:true});b[6]=2;b[8]=3;
  const [p]=wirelessBlockPackets('settings',b);assert.deepEqual([...p.slice(0,3)],[7,16,0]);assert.equal(p[offset+3],1);assert.equal(p[9],2);assert.equal(p[11],3);assert.deepEqual([...p.slice(17,19)],[170,85]);assert.equal(p[31],p.slice(0,31).reduce((a,b)=>a+b,0)&255);
 }
});
test('keymap chunks retain the final marker across the 28-byte boundary',()=>{
 const b=Uint8Array.from({length:576},(_,i)=>i%256);const packets=wirelessBlockPackets('keys',b);
 assert.equal(packets.length,21);assert.deepEqual([...packets.at(-1).slice(0,3)],[16,16,20]);
 const decoded=Uint8Array.from(packets.flatMap(p=>[...p.slice(3,31)]));assert.deepEqual(decoded.slice(0,574),b.slice(0,574));assert.deepEqual([...decoded.slice(574,576)],[170,85]);
});
test('empty macros send only used table plus a separate marker page',()=>{
 const packets=wirelessBlockPackets('macros',compileMacroBank([]));assert.equal(packets.length,16);assert.deepEqual([...packets.at(-1).slice(0,3)],[9,8,15]);assert.deepEqual([...packets.at(-1).slice(29,31)],[170,85]);
});
test('wireless receiver uses output reports and matches checksummed input acknowledgements',async()=>{
 const d=device();const hid=new WirelessHID(d);const b=new Uint8Array(64);b[8]=2;
 await hid.writeBlock('settings',b);assert.equal(d.sent[0],0);assert.equal(d.sent[1][0],7);assert.equal(hid.faulted,false);hid.dispose();
});
test('bad response checksum faults the transport instead of claiming success',async()=>{
 const d=device();d.sendReport=async(id,b)=>{const reply=wirelessPacket(...b.slice(0,3));reply[31]^=1;queueMicrotask(()=>d.listener({reportId:0,data:new DataView(reply.buffer)}));};
 const hid=new WirelessHID(d);await assert.rejects(hid.writeBlock('lighting',new Uint8Array(64)),/校验/);assert.equal(hid.faulted,true);hid.dispose();
});
