import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AutoApply} from '../web/auto-apply.js';

test('edits during an in-flight write keep the latest revision and run serially',async()=>{
 let release;const gate=new Promise(r=>release=r);let value=1;const writes=[];const committed=[];
 const q=new AutoApply({wait:100000,ready:()=>true,write:async(name,current)=>{const snapshot=value;writes.push(snapshot);if(writes.length===1)await gate;if(current())committed.push(snapshot);}});
 q.mark('settings');const done=q.flush();value=2;q.mark('settings');value=3;q.mark('settings');release();await done;q.clear();
 assert.deepEqual(writes,[1,3]);assert.deepEqual(committed,[3]);assert.equal(q.pending.size,0);
});
test('offline edits remain pending; macros are written before their bindings',async()=>{
 let connected=false;const writes=[];const q=new AutoApply({wait:100000,ready:()=>connected,write:async n=>writes.push(n)});
 q.mark('keys');q.mark('macros');await q.flush();assert.equal(q.pending.size,2);
 connected=true;await q.flush();q.clear();assert.deepEqual(writes,['macros','keys']);
});
test('failed writes stay pending without an automatic retry loop',async()=>{
 let attempts=0;const errors=[];const q=new AutoApply({wait:100000,ready:()=>true,write:async()=>{attempts++;throw Error('disconnected');},onError:e=>errors.push(e.message)});
 q.mark('settings');await q.flush();assert.equal(q.pending.size,1);q.clear();assert.equal(attempts,1);assert.deepEqual(errors,['disconnected']);
});
