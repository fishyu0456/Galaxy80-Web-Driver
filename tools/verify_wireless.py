"""Reapply known backed-up settings via receiver, checking every acknowledgement."""
from wireless_probe import *
if __name__=='__main__':
 packets=json.loads(pathlib.Path('research/wireless-verification-packets.json').read_text())
 h=open_receiver();results={}
 try:
  for name,rows in packets.items():
   for values in rows:
    b=bytes(values)
    try:reply=exchange(h,b[0],b[1],b[2],b[3:31])
    except Exception:
     print('FAILED',name,'page',b[2],flush=True);raise
    time.sleep(.02)
   results[name]={'acknowledgedPackets':len(rows)}
   print(name,results[name],flush=True)
  pathlib.Path('research/wireless-verification.json').write_text(json.dumps(results,indent=2))
 finally:k.CloseHandle(h)
