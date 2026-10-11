"""Read-only Windows HID enumeration. No output reports are sent."""
import ctypes as c
from ctypes import wintypes as w
import json, pathlib
hid=c.WinDLL('hid',use_last_error=True)
setup=c.WinDLL('setupapi',use_last_error=True)
k=c.WinDLL('kernel32',use_last_error=True)
class GUID(c.Structure):
 _fields_=[('a',w.DWORD),('b',w.WORD),('d',w.WORD),('e',c.c_ubyte*8)]
class IFACE(c.Structure):
 _fields_=[('cbSize',w.DWORD),('guid',GUID),('flags',w.DWORD),('reserved',c.c_void_p)]
class CAPS(c.Structure):
 _fields_=[('usage',w.USHORT),('usagePage',w.USHORT),('inputLength',w.USHORT),('outputLength',w.USHORT),('featureLength',w.USHORT),('reserved',w.USHORT*17),('linkNodes',w.USHORT),('inputButtons',w.USHORT),('inputValues',w.USHORT),('inputData',w.USHORT),('outputButtons',w.USHORT),('outputValues',w.USHORT),('outputData',w.USHORT),('featureButtons',w.USHORT),('featureValues',w.USHORT),('featureData',w.USHORT)]
setup.SetupDiGetClassDevsW.argtypes=[c.POINTER(GUID),w.LPCWSTR,w.HWND,w.DWORD]; setup.SetupDiGetClassDevsW.restype=w.HANDLE
setup.SetupDiEnumDeviceInterfaces.argtypes=[w.HANDLE,c.c_void_p,c.POINTER(GUID),w.DWORD,c.POINTER(IFACE)]
setup.SetupDiGetDeviceInterfaceDetailW.argtypes=[w.HANDLE,c.POINTER(IFACE),c.c_void_p,w.DWORD,c.POINTER(w.DWORD),c.c_void_p]
setup.SetupDiDestroyDeviceInfoList.argtypes=[w.HANDLE]
k.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,c.c_void_p,w.DWORD,w.DWORD,w.HANDLE]; k.CreateFileW.restype=w.HANDLE
k.CloseHandle.argtypes=[w.HANDLE]
hid.HidD_GetPreparsedData.argtypes=[w.HANDLE,c.POINTER(c.c_void_p)]
hid.HidP_GetCaps.argtypes=[c.c_void_p,c.POINTER(CAPS)]
hid.HidD_FreePreparsedData.argtypes=[c.c_void_p]
hid.HidD_GetProductString.argtypes=[w.HANDLE,c.c_void_p,w.ULONG]
hid.HidD_GetFeature.argtypes=[w.HANDLE,c.c_void_p,w.ULONG]
hid.HidD_SetFeature.argtypes=[w.HANDLE,c.c_void_p,w.ULONG]
hid.HidP_GetValueCaps.argtypes=[c.c_int,c.c_void_p,c.POINTER(w.USHORT),c.c_void_p]
def enumerate_target():
 guid=GUID(); hid.HidD_GetHidGuid(c.byref(guid)); info=setup.SetupDiGetClassDevsW(c.byref(guid),None,None,0x12)
 results=[]
 try:
  i=0
  while True:
   face=IFACE(); face.cbSize=c.sizeof(face)
   if not setup.SetupDiEnumDeviceInterfaces(info,None,c.byref(guid),i,c.byref(face)): break
   i+=1; required=w.DWORD()
   setup.SetupDiGetDeviceInterfaceDetailW(info,c.byref(face),None,0,c.byref(required),None)
   buf=c.create_string_buffer(required.value); c.cast(buf,c.POINTER(w.DWORD))[0]=8 if c.sizeof(c.c_void_p)==8 else 6
   if not setup.SetupDiGetDeviceInterfaceDetailW(info,c.byref(face),buf,len(buf),None,None): continue
   path=c.wstring_at(c.addressof(buf)+4)
   if 'vid_05ac&pid_024f' not in path.lower(): continue
   handle=k.CreateFileW(path,0,3,None,3,0,None)
   entry={'path':path}
   if handle==c.c_void_p(-1).value: entry['error']=c.get_last_error(); results.append(entry); continue
   try:
    name=c.create_unicode_buffer(256)
    if hid.HidD_GetProductString(handle,name,c.sizeof(name)): entry['product']=name.value
    pp=c.c_void_p()
    if hid.HidD_GetPreparsedData(handle,c.byref(pp)):
     try:
      caps=CAPS(); hid.HidP_GetCaps(pp,c.byref(caps))
      entry.update({n:getattr(caps,n) for n,_ in CAPS._fields_ if n!='reserved'})
      for t,field in [(0,'inputValues'),(1,'outputValues'),(2,'featureValues')]:
       count=w.USHORT(getattr(caps,field))
       if count.value:
        values=c.create_string_buffer(72*count.value)
        status=hid.HidP_GetValueCaps(t,values,c.byref(count),pp)
        entry[field+'Caps']=[{'raw':values.raw[j*72:(j+1)*72].hex(),'reportId':values.raw[j*72+2]} for j in range(count.value)]
     finally: hid.HidD_FreePreparsedData(pp)
   finally: k.CloseHandle(handle)
   results.append(entry)
 finally: setup.SetupDiDestroyDeviceInfoList(info)
 return results
if __name__=='__main__':
 result=enumerate_target()
 pathlib.Path('research/hid-interfaces.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2))
