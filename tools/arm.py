import pathlib,sys,re
sys.path.insert(0,str(pathlib.Path(__file__).parent/'deps'))
from capstone import *
b=pathlib.Path('research/firmware.bin').read_bytes()
s=int(sys.argv[1],16); e=int(sys.argv[2],16)
md=Cs(CS_ARCH_ARM,CS_MODE_THUMB); md.skipdata=True
for a,z,m,o in md.disasm_lite(b[s:e],s):
 c=''; match=re.search(r'\[pc, #(0x[0-9a-f]+|\d+)\]',o)
 if match:
  ptr=((a+4)&~3)+int(match.group(1),0)
  c=f' ; [{ptr:04x}]={int.from_bytes(b[ptr:ptr+4],"little"):08x}'
 print(f'{a:04x} {m:7} {o}{c}')
