# Galaxy80 2.4G protocol

Recovered from installed VTER Driver and supplied SN32F240.hex. USB ID 05AC:024F,
product Galaxy80-2.4g. Configuration interface MI03 uses usage FF60:61 and report
ID 0, 32 payload bytes in both directions. Reject the 64-byte MI04 sibling.
WebHID uses sendReport and inputreport, not feature reports.

Packet: opcode, length, page index, 28 data bytes, sum of preceding 31 bytes modulo
256. Match replies by the first three bytes and validate checksum. An ACK is not
configuration readback. Query 02/00/00 gets device info; 20/01/00 gets battery.

| Block | Opcode | Transfer |
| --- | --- | --- |
| Settings | 07 | length 16; first 28 bytes; AA55 at data 14/15 |
| Lighting | 05 | length 16; AA55 at data 14/15 |
| Keys | 10 | 576 bytes, 21 pages of 28 bytes |
| Fn | 12 | same |
| Colors | 14 | same |
| Macros | 09 | used table/events, rounded up plus one marker page |

Keys/Fn/colors use AA55 at data offsets 574/575. Last packet length is 16, with
28-byte zero-padded payload. Firmware programs all 28 bytes regardless of length.
Macros use a 400-byte offset table followed by records. Used size is the maximum
record end (offset + 8 + recordCount * 4), or 400 for an empty bank. Desktop routine
42e218 allocates ceil(used/28)+1 pages and places AA55 at the final two bytes. Last
header length is used modulo 28. Do not send the entire 3072-byte wired bank.

Firmware wireless dispatcher is at 47ac. No full configuration read operation
was found. Opcode 0B draws a special 14-column spectrum, not arbitrary per-key
RGB frames; current browser realtime effects remain wired-only.

## Verification, 2026-10-11

Fresh wired backup was captured before changing transport. Native receiver tests
using the JavaScript packet encoder reapplied existing settings (1 ACK), keys
(21), Fn (21), compact empty macros (16), colors (21), and lighting (1).
Info and battery queries also returned valid checksums. A full wired-size macro
transfer previously timed out; after the user woke the keyboard, compact macro
transfer succeeded. The timeout cause was not conclusively isolated.

Browser WebHID connection subsequently succeeded, displaying 2.4G and 95% battery.
The browser communication log showed valid settings and lighting acknowledgements.
The user physically confirmed that lighting changes and all three shortcut locks
work over wireless. Other blocks have packet-level validation only; physical macro
playback and every mapping/response setting have not been separately tested.
