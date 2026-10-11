"""Reapply current settings without changing them; require exact readback."""
from backup_device import *

def read_settings(h):
 send(h,packet(0x16,0)); b=receive(h)
 if b[:4]==bytes([4,0x16,0,1]): b=receive(h)
 end=command(h,2)
 assert int.from_bytes(end[4:8],'little')==sum(b),'Read checksum mismatch'
 return b

def write_settings(h,data):
 command(h,0x18)
 select=packet(0x17,1);select[2]=1
 send(h,select);ack=receive(h)
 assert ack[:4]==bytes([4,0x17,1,1]),'Select rejected'
 send(h,data);end=command(h,2)
 assert int.from_bytes(end[4:8],'little')==sum(data),'Write checksum mismatch'
 assert read_settings(h)==bytes(data),'Settings readback mismatch'

if __name__=='__main__':
 device=next(d for d in enumerate_target() if d.get('usagePage')==0xff13 and d.get('product')=='Galaxy80')
 h=k.CreateFileW(device['path'],0xc0000000,3,None,3,0,None)
 try:
  original=read_settings(h)
  stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
  pathlib.Path(f'research/settings-before-{stamp}.json').write_text(json.dumps({'data':original.hex()}))
  print('Read settings',original.hex(),flush=True)
  print('Begin',command(h,0x18)[:8].hex(),flush=True)
  select=packet(0x17,1);select[2]=1
  send(h,select);ack=receive(h)
  print('Select',ack.hex(),flush=True)
  assert ack[:4]==bytes([4,0x17,1,1]),'Select not acknowledged; no settings data sent'
  data=bytearray(original);data[62:64]=bytes.fromhex('aa55')
  send(h,data);end=command(h,2)
  assert int.from_bytes(end[4:8],'little')==sum(data),'Write checksum mismatch'
  result=read_settings(h)
  assert result==bytes(data),'Settings readback mismatch'
  pathlib.Path('research/settings-verification.json').write_text(json.dumps({'identicalReadback':True,'data':result.hex(),'time':stamp},indent=2))
  print('Settings write and readback verified',flush=True)
  import sys
  if '--exercise' in sys.argv:
   changed=bytearray(data)
   for i in (2,3,4):changed[i]=0 if changed[i] else 1
   changed[8]=2 if changed[8]!=2 else 1
   try:
    write_settings(h,changed)
    print('All three shortcut flags and response changed: exact readback verified',flush=True)
   finally:
    write_settings(h,data)
    print('Original settings restored and verified',flush=True)
 finally:k.CloseHandle(h)
