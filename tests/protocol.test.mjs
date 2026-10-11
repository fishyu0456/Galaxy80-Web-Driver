import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GalaxyHID,packet,sum,readShortcutLocks,writeShortcutLocks} from '../web/protocol.js';

test('each individual lock reaches the firmware bit checked for that shortcut',()=>{
 const original=new Uint8Array(64);original[1]=1;original[6]=2;original[8]=3;
 for(const [name,expectedBit,offset] of [['disableWin',0x80,4],['disableAltF4',0x40,3],['disableAltTab',0x20,2]]){
  const out=writeShortcutLocks(original,{[name]:true});
  const word=new DataView(out.buffer).getUint32(0,true);
  // Literal shifts from firmware 0x3b94..0x3bb0, independently of the UI map.
  const runtime=(out[0]|((word&0xffff)>>>4)|(word>>>11)|(word>>>18)|(out[4]<<7))&255;
  assert.equal(runtime&0xe0,expectedBit,name);
  assert.equal(out[offset],1);assert.equal(out[6],2);assert.equal(out[8],3);
  assert.deepEqual(readShortcutLocks(out),{disableWin:name==='disableWin',disableAltF4:name==='disableAltF4',disableAltTab:name==='disableAltTab'});
  assert.deepEqual(writeShortcutLocks(out,{}),original);
 }
});

test('settings write updates all shortcut flags and response, with no F0 reload',async()=>{
 const hid=Object.create(GalaxyHID.prototype);hid.device={opened:true};hid.busy=false;hid.faulted=false;
 const sent=[];const source=new Uint8Array(64);source.set([0,1,1,1,1,0,2,0,3]);let stored;
 hid.send=async b=>{sent.push(b.slice());if(sent.length===3)stored=b.slice();};
 hid.receive=async()=>{
  const last=sent.at(-1);const response=last.slice();
  if(last[0]===4&&last[1]===0x16)return stored.slice();
  response[3]=1;if(last[1]===2)new DataView(response.buffer).setUint32(4,sum(stored),true);return response;
 };
 const result=await hid.writeBlock('settings',source);
 assert.deepEqual(sent.map((b,i)=>i===2?'data':b[1]),[0x18,0x17,'data',2,0x16,2]);
 assert.equal(sent[1][2],1);assert.equal(sent[1][8],1);assert.equal(sent[4][8],0);
 assert.deepEqual([...result.slice(2,5)],[1,1,1]);assert.equal(result[8],3);assert.deepEqual([...result.slice(62)],[170,85]);
 assert.equal(source[62],0);
});
