#!/usr/bin/env python3
"""gen_expected_journal.py — the cross-language byte pin.

Builds the EXPECTED quilt-c kernel journal bytes for a fixed op script,
implementing the exact format read from src/engine.c:243-237 (cited):
  entry = op(1) || id_len(2 LE, low bytes of size_t) || id || arg(8 LE int64)
  BIND create arg=1 | BIND update arg=version | LINK id=from arg=to_index
  EFFECT id arg=version (only on change) | TICK id_len=0 arg=tick | FORGET arg=0

If the C port's journal matches these bytes, both sides implement the same
opcode semantics — the strongest cross-language pin available short of
running the kernel in-process.
Output line 1: hex of expected journal. Line 2: fnv1a64 of it (the gdigest).
"""
import struct

FNV_OFF = 0xcbf29ce484222325
FNV_PRIME = 0x100000001b3
MASK = (1 << 64) - 1


def fnv1a64(data: bytes) -> int:
    h = FNV_OFF
    for b in data:
        h ^= b
        h = (h * FNV_PRIME) & MASK
    return h


def entry(op: int, ident: str | None, arg: int) -> bytes:
    out = bytes([op])
    if ident:
        ib = ident.encode()
        out += struct.pack("<H", len(ib)) + ib
    else:
        out += b"\x00\x00"
    out += struct.pack("<q", arg)
    return out


# the fixed script (cell order A1, B1; both created before the link)
cells = []          # creation order
versions = {}


def bind(addr, value):
    if addr not in versions:
        cells.append(addr)
        versions[addr] = 1
        return entry(0, addr, 1)
    versions[addr] += 1
    return entry(0, addr, versions[addr])


journal = b""
journal += bind("A1", 1)          # create, arg=1
journal += bind("B1", 3)          # create, arg=1
journal += bind("A1", 2)          # update, arg=version=2
journal += entry(1, "A1", 1)      # LINK from=A1 to=B1(index 1), arg=j
# EFFECT A1: value cell (no eval) -> no journal entry
journal += entry(4, None, 1)      # TICK arg=tick=1
# VIEW A1: pure, no entry
journal += entry(5, "B1", 0)      # FORGET B1 arg=0

print(journal.hex())
print(f"{fnv1a64(journal):016x}")
