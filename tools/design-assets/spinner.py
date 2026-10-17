"""Writes a small self-made animated GIF (a spinner) and its first-frame still.

Usage: python tools/design-assets/spinner.py apps/web/src/features/design
"""
import math
import struct
import sys

SIZE = 32
FRAMES = 8
DELAY = 12  # hundredths: 0.12 s a frame, 0.96 s a loop
PALETTE = [(0, 0, 0), (0x2F, 0x6B, 0xD6), (0xC4, 0xD4, 0xF2), (0xFF, 0xFF, 0xFF)]


def frame_pixels(step):
    pixels = []
    centre = (SIZE - 1) / 2
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - centre, y - centre
            radius = math.hypot(dx, dy)
            if 9 <= radius <= 14:
                angle = (math.degrees(math.atan2(dy, dx)) + 360) % 360
                segment = int(angle // (360 / FRAMES))
                pixels.append(1 if segment == step % FRAMES else 2)
            else:
                pixels.append(0)  # transparent
    return pixels


def lzw(pixels, min_code_size=2):
    clear = 1 << min_code_size
    end = clear + 1
    out_bits = []

    def emit(code, width):
        for bit in range(width):
            out_bits.append((code >> bit) & 1)

    table = {(i,): i for i in range(clear)}
    next_code = end + 1
    width = min_code_size + 1
    emit(clear, width)
    current = (pixels[0],)
    for pixel in pixels[1:]:
        candidate = current + (pixel,)
        if candidate in table:
            current = candidate
            continue
        emit(table[current], width)
        if next_code < 4096:
            table[candidate] = next_code
            next_code += 1
            if next_code > (1 << width) and width < 12:
                width += 1
        else:
            emit(clear, width)
            table = {(i,): i for i in range(clear)}
            next_code = end + 1
            width = min_code_size + 1
        current = (pixel,)
    emit(table[current], width)
    emit(end, width)
    data = bytearray()
    for index in range(0, len(out_bits), 8):
        byte = 0
        for bit, value in enumerate(out_bits[index:index + 8]):
            byte |= value << bit
        data.append(byte)
    blocks = bytearray([min_code_size])
    for index in range(0, len(data), 255):
        chunk = data[index:index + 255]
        blocks.append(len(chunk))
        blocks += chunk
    blocks.append(0)
    return bytes(blocks)


def gif(frames, loops):
    head = b'GIF89a' + struct.pack('<HHBBB', SIZE, SIZE, 0xF1, 0, 0)
    head += bytes(c for colour in PALETTE for c in colour)
    body = b''
    if loops is not None:
        body += b'\x21\xFF\x0BNETSCAPE2.0\x03\x01' + struct.pack('<H', loops) + b'\x00'
    for step in frames:
        # Graphic control: dispose to background, transparent index 0.
        body += b'\x21\xF9\x04\x09' + struct.pack('<H', DELAY) + b'\x00\x00'
        body += b'\x2C' + struct.pack('<HHHHB', 0, 0, SIZE, SIZE, 0)
        body += lzw(frame_pixels(step))
    return head + body + b'\x3B'


out = sys.argv[1]
# Repeats twice after the first play: three plays in all, as the server bounds uploads (ADR-047).
open(f'{out}/spinner.gif', 'wb').write(gif(range(FRAMES), loops=2))
open(f'{out}/spinner-still.gif', 'wb').write(gif([0], loops=None))
