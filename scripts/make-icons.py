#!/usr/bin/env python3
"""Writes three solid-colour PNG icons. Replace with real artwork any time."""
import os
import struct
import zlib

COLOR = (30, 58, 95)  # navy
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, rgb):
    scanline = b"\x00" + bytes(rgb) * size
    raw = scanline * size
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


os.makedirs(OUT, exist_ok=True)
for size in (16, 48, 128):
    write_png(os.path.join(OUT, f"{size}.png"), size, COLOR)
    print(f"wrote icons/{size}.png")
