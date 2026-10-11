import pathlib,sys,hashlib,json,re
sys.path.insert(0,str(pathlib.Path(__file__).parent/'deps'))
from capstone import *
root=pathlib.Path(__file__).resolve().parent.parent
mem={}; upper=0
for line in (root/'SN32F240.hex').read_text().splitlines():
 b=bytes.fromhex(line[1:]); assert sum(b)%256==0
 n,addr,typ=b[0],int.from_bytes(b[1:3],'big'),b[3]
 if typ==4: upper=int.from_bytes(b[4:6],'big')<<16
 if typ==0:
  for i,v in enumerate(b[4:4+n]): mem[upper+addr+i]=v
data=bytes(mem.get(i,255) for i in range(max(mem)+1))
(root/'research/firmware.bin').write_bytes(data)
print('bytes',len(data),'sha256',hashlib.sha256(data).hexdigest())
md=Cs(CS_ARCH_ARM,CS_MODE_THUMB|CS_MODE_LITTLE_ENDIAN); md.skipdata=True
(root/'research/firmware.asm').write_text('\n'.join(f'{a:08x} {m:8} {o}' for a,s,m,o in md.disasm_lite(data,0)))
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){4,}',data): print(hex(m.start()),m.group().decode('utf-16le'))
