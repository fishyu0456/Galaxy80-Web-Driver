"""Reapply unchanged lighting bytes, then verify a byte-exact readback."""
from backup_device import *
if __name__=='__main__':
 baseline=json.loads(pathlib.Path('research/device-backup.json').read_text())
 original=bytes.fromhex(baseline['blocks']['lighting']['data'])
 assert len(original)==64 and original[14:16]==bytes.fromhex('aa55')
 device=next(d for d in enumerate_target() if d.get('usagePage')==0xff13 and d.get('product')=='Galaxy80')
 h=k.CreateFileW(device['path'],0xc0000000,3,None,3,0,None)
 try:
  send(h,packet(2)); print('sync',receive(h)[:8].hex())
  print('begin',command(h,0x18)[:8].hex())
  print('select',command(h,0x13,1)[:8].hex())
  send(h,original); time.sleep(.04)
  end=command(h,2); print('checksum',end[:8].hex())
  assert int.from_bytes(end[4:8],'little')==sum(original)
  command(h,0xf0); time.sleep(.1)
  send(h,packet(0x12,0)); data=receive(h)
  if data[:4]==bytes([4,0x12,0,1]): data=receive(h)
  end=command(h,2)
  assert data==original,(data.hex(),original.hex())
  assert int.from_bytes(end[4:8],'little')==sum(data)
  result={'operation':'reapply unchanged lighting','identicalReadback':True,'bytes':len(data),'checksum':sum(data)}
  pathlib.Path('research/hardware-verification.json').write_text(json.dumps(result,indent=2))
  print(result)
 finally: k.CloseHandle(h)
