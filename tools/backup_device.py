"""Read current Galaxy80 configuration via firmware-confirmed read opcodes only."""
from hid_inspect import *
import time,datetime
k.DeviceIoControl.argtypes=[w.HANDLE,w.DWORD,c.c_void_p,w.DWORD,c.c_void_p,w.DWORD,c.POINTER(w.DWORD),c.c_void_p]
def packet(op,count=0):
 b=bytearray(64); b[0:2]=bytes([4,op]); b[8]=count; return b
def send(h,b):
 buf=c.create_string_buffer(bytes([0])+bytes(b),65)
 if not hid.HidD_SetFeature(h,buf,65): raise c.WinError(c.get_last_error())
 time.sleep(.04)
def receive(h):
 buf=c.create_string_buffer(65)
 returned=w.DWORD()
 if not k.DeviceIoControl(h,0xb0192,buf,65,buf,65,c.byref(returned),None): raise c.WinError(c.get_last_error())
 time.sleep(.04)
 return bytes(buf.raw[1:])
def command(h,op,count=0):
 send(h,packet(op,count)); b=receive(h)
 for _ in range(10):
  if b[:2]==bytes([4,op]) and b[3]==0: b=receive(h)
  else: break
 if b[0]!=4 or b[1]!=op or b[3]!=1: raise RuntimeError(f'Unexpected response {b.hex()}')
 return b
if __name__=='__main__':
 devices=[d for d in enumerate_target() if d.get('usagePage')==0xff13 and d.get('product')=='Galaxy80' and d.get('featureLength')==65]
 assert len(devices)==1,'Expected one Galaxy80 vendor interface'
 h=k.CreateFileW(devices[0]['path'],0xc0000000,3,None,3,0,None)
 if h==c.c_void_p(-1).value: raise c.WinError(c.get_last_error())
 result={'product':'Galaxy80','created':datetime.datetime.now().isoformat(),'blocks':{}}
 try:
  send(h,packet(2)); print('initial end',receive(h).hex(),flush=True)
  for name,op,count in [('lighting',0x12,1),('settings',0x16,1),('keys',0x10,9),('fn',0x26,9),('colors',0x22,9),('macros',0x14,48)]:
   time.sleep(.1)
   send(h,packet(op,count-1)); ack=receive(h)
   if ack[:2]==bytes([4,op]) and ack[3]==1:
    data=b''.join(receive(h) for _ in range(count))
   elif ack[:2]==bytes([4,op]): raise RuntimeError('Rejected '+ack.hex())
   else:
    print('Data-first response',name,flush=True)
    data=ack+b''.join(receive(h) for _ in range(count-1))
   checksum=command(h,2)
   result['blocks'][name]={'opcode':op,'data':data.hex(),'checksumResponse':checksum.hex()}
   print(name,len(data),'first64',data[:64].hex(),'sum',sum(data),'ack',checksum[:8].hex(),flush=True)
   pathlib.Path('research/device-backup.json').write_text(json.dumps(result,indent=2))
 finally: k.CloseHandle(h)
