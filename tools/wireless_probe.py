"""Galaxy80 receiver interrupt-report transport; read-only info/battery probe."""
from hid_inspect import *
import time,sys
class OVERLAPPED(c.Structure):
 _fields_=[('internal',c.c_size_t),('internalHigh',c.c_size_t),('offset',w.DWORD),('offsetHigh',w.DWORD),('event',w.HANDLE)]
k.CreateEventW.argtypes=[c.c_void_p,w.BOOL,w.BOOL,w.LPCWSTR];k.CreateEventW.restype=w.HANDLE
k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD]
k.ReadFile.argtypes=[w.HANDLE,c.c_void_p,w.DWORD,c.POINTER(w.DWORD),c.POINTER(OVERLAPPED)]
k.WriteFile.argtypes=k.ReadFile.argtypes
k.GetOverlappedResult.argtypes=[w.HANDLE,c.POINTER(OVERLAPPED),c.POINTER(w.DWORD),w.BOOL]
k.CancelIoEx.argtypes=[w.HANDLE,c.POINTER(OVERLAPPED)]

def io(h,buf,write=False,timeout=1500):
 ov=OVERLAPPED();ov.event=k.CreateEventW(None,True,False,None);n=w.DWORD()
 try:
  ok=(k.WriteFile if write else k.ReadFile)(h,buf,len(buf),c.byref(n),c.byref(ov))
  if not ok:
   error=c.get_last_error()
   if error!=997:raise c.WinError(error)
   if k.WaitForSingleObject(ov.event,timeout)!=0:
    k.CancelIoEx(h,c.byref(ov));k.GetOverlappedResult(h,c.byref(ov),c.byref(n),True)
    raise TimeoutError('No receiver reply')
   if not k.GetOverlappedResult(h,c.byref(ov),c.byref(n),True):raise c.WinError(c.get_last_error())
  return bytes(buf.raw[:n.value])
 finally:k.CloseHandle(ov.event)

def exchange(h,op,length=0,index=0,data=b''):
 b=bytearray(33);b[1:4]=bytes([op,length,index]);b[4:4+len(data)]=data;b[32]=sum(b[:32])&255
 io(h,c.create_string_buffer(bytes(b),33),True)
 deadline=time.monotonic()+2
 while time.monotonic()<deadline:
  result=io(h,c.create_string_buffer(33))[1:]
  if result[:3]==b[1:4]:
   assert len(result)==32 and (sum(result[:31])&255)==result[31],'Receiver checksum mismatch'
   return result
 raise TimeoutError('No matching reply')

def open_receiver():
 d=next(d for d in enumerate_target() if d.get('product')=='Galaxy80-2.4g' and d.get('usagePage')==0xff60 and d.get('outputLength')==33)
 h=k.CreateFileW(d['path'],0xc0000000,3,None,3,0x40000000,None)
 if h==c.c_void_p(-1).value:raise c.WinError(c.get_last_error())
 return h

if __name__=='__main__':
 h=open_receiver()
 try:
  for op,length in [(2,0),(0x20,1)]:
   result=exchange(h,op,length);print(hex(op),result.hex(),flush=True)
 finally:k.CloseHandle(h)
