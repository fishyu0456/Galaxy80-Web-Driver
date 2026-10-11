// Coalesce edits while preserving changes made during an in-flight write.
export class AutoApply {
 constructor({write,ready,onError=()=>{},onIdle=()=>{},wait=250}){Object.assign(this,{write,ready,onError,onIdle,wait});this.pending=new Map();this.active=false;this.timer=null;this.revision=0;}
 mark(name){this.pending.set(name,++this.revision);this.schedule();}
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),this.wait);}
 clear(){this.pending.clear();clearTimeout(this.timer);}
 async flush(){
  clearTimeout(this.timer);
  if(this.active||!this.pending.size||!this.ready())return;
  this.active=true;
  try{
   while(this.pending.size&&this.ready()){
    const name=['macros','keys','fn','colors','settings','lighting'].find(n=>this.pending.has(n));
    const revision=this.pending.get(name);
    await this.write(name,()=>this.pending.get(name)===revision);
    if(this.pending.get(name)===revision)this.pending.delete(name);
   }
  }catch(e){this.onError(e);}finally{this.active=false;this.onIdle();}
 }
}
