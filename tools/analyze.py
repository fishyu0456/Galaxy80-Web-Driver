import sys, pathlib, re, json, struct
sys.path.insert(0,str(pathlib.Path(__file__).parent/'deps'))
import pefile
from capstone import *
root=pathlib.Path(__file__).resolve().parent.parent
for filename in ['DeviceDriver.exe','mui.dll']:
 p=pefile.PE(str(pathlib.Path(r'D:\Program Files\VTER Driver')/filename))
 base=p.OPTIONAL_HEADER.ImageBase
 imports={base+i.address-base:i.name.decode(errors='replace') if i.name else str(i.ordinal) for d in p.DIRECTORY_ENTRY_IMPORT for i in d.imports}
 (root/'research'/f'{filename}.imports.json').write_text(json.dumps({hex(k):v for k,v in imports.items()},indent=2))
 md=Cs(CS_ARCH_X86,CS_MODE_32 if p.FILE_HEADER.Machine==0x14c else CS_MODE_64)
 lines=[]
 for s in p.sections:
  if s.Characteristics & 0x20000000:
   md.skipdata=True
   for a,size,mn,op in md.disasm_lite(s.get_data(),base+s.VirtualAddress):
    comment=''
    for v in re.findall(r'0x[0-9a-f]+',op):
     if int(v,16) in imports: comment=' ; '+imports[int(v,16)]
    lines.append(f'{a:08x} {mn:8} {op}{comment}')
 (root/'research'/f'{filename}.asm').write_text('\n'.join(lines))
 print(filename,hex(base),len(lines),[(hex(k),v) for k,v in imports.items() if any(x in v.lower() for x in ['hid','writefile','deviceio','readfile','loadlibrary','getproc'])])
 data=p.__data__
 strings=[]
 for pat,enc in [(rb'[\x20-\x7e]{5,}','ascii'),(rb'(?:[\x20-\x7e]\x00){5,}','utf-16le')]:
  for m in re.finditer(pat,data):
   try: addr=base+p.get_rva_from_offset(m.start())
   except: continue
   strings.append(f'{addr:08x} {m.group().decode(enc)}')
 (root/'research'/f'{filename}.strings.txt').write_text('\n'.join(strings))
