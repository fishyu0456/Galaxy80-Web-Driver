import pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).parent/'deps'))
import pefile
from capstone import *
p=pefile.PE(r'D:\Program Files\VTER Driver\DeviceDriver.exe')
base=p.OPTIONAL_HEADER.ImageBase
start=int(sys.argv[1],16); end=int(sys.argv[2],16)
md=Cs(CS_ARCH_X86,CS_MODE_32); md.skipdata=True
for a,s,m,o in md.disasm_lite(p.get_data(start-base,end-start),start): print(f'{a:08x} {m:8} {o}')
