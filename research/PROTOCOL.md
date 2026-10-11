# Galaxy80 protocol notes

Source: locally supplied `SN32F240.hex` and installed VTER Driver.

## Shortcut locks (corrected 2026-10-11)

Settings block read opcode `0x16`, write opcode `0x17`, 64 bytes.

| Settings byte | Runtime bit | Function |
| --- | --- | --- |
| 2 | 5 (`0x20`) | Left Alt + Tab |
| 3 | 6 (`0x40`) | Left Alt + F4 |
| 4 | 7 (`0x80`) | Windows / GUI keys (firmware also blocks usage `0x65`) |

Evidence in supplied firmware:

- `0x3b94–0x3bb0`: settings bytes are packed into runtime flags at `0x2000015d`.
- `0x2f38–0x2f4a`: bit 7 suppresses usages `0xe3`, `0xe7`, `0x65`.
- `0x3038–0x304e`: bit 5 suppresses Tab (`0x2b`) when the tracked Alt flag is set.
- `0x3050–0x3062`: bit 6 suppresses F4 (`0x3d`) when that flag is set.
- `0x2e64–0x2e76`: the Alt flag is updated by left Alt (`0xe2`), not right Alt.

The earlier UI incorrectly assigned byte 2 to Windows and byte 4 to Alt+Tab.
Testing all three bytes simultaneously could not detect this swap. Regression
tests now enable each lock separately and check the firmware's bit conversion.

Settings writes use `04 18`, then `04 17` with byte 2 = 1 and page count 1,
one data page (marker `aa55` at bytes 62/63), then `04 02` with checksum.
They do not use the lighting/key reload command `04 f0`.

## Verification boundary

Hardware setting write/readback was tested, including changed shortcut bytes
and response byte 8, with original settings restored afterward. This verifies
storage and transport, **not physical shortcut suppression**. Physical behavior
requires a real keypress; synthetic OS/browser key events bypass the firmware.
The supplied firmware's behavior may also differ from the currently installed
firmware. After the offset correction, the user confirmed physical Windows-key
suppression works (2026-10-11). The user then also confirmed that both Left
Alt+Tab and Left Alt+F4 are successfully suppressed in the updated page.
