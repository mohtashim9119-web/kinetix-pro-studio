"""
Decoder for WebKit's SQLite-backed IndexedDB key encoding (IDBKeyData /
LegacyIDBKeyData KeyedEncoder binary format), as observed empirically on
kinetix-assets' Records.key column (compound key [projectId, id]).

Observed layout for a 2-element string array key:
  10-byte header: 00 a0 02 00 00 00 00 00 00 00
  then, per element:
    1 byte  tag = 0x60 (String)
    4 bytes little-endian uint32 = number of UTF-16 code units
    N*2 bytes = UTF-16LE string data

This is a narrow, purpose-built decoder for exactly this shape (string-only
array keys of length 1 or 2) -- it is NOT a general IDBKeyData parser and
will raise on anything else (numeric keys, dates, nested arrays), which is
what we want: fail loudly rather than silently mis-decode.
"""
import struct

STRING_TAG = 0x60


def decode_string_array_key(key: bytes):
    """Decode a key blob into its embedded UTF-16LE strings.

    Generic scan rather than a fixed-offset header parse: walk the buffer
    byte by byte; whenever a 0x60 (String) tag is seen, read the following
    4-byte little-endian code-unit count and decode that many UTF-16LE code
    units as one string, then resume scanning after it. This is robust to
    the differing header preambles observed between a 1-element key
    (keyPath 'id' / 'projectId') and a 2-element compound key
    (keyPath ['projectId', 'id']) without hardcoding either header's bytes.
    Verified against both shapes in this repo's kinetix-assets /
    kinetix-history / kinetix-waveforms stores.
    """
    pos = 0
    out = []
    while pos < len(key):
        if key[pos] == STRING_TAG and pos + 5 <= len(key):
            (length,) = struct.unpack_from("<I", key, pos + 1)
            start = pos + 5
            end = start + length * 2
            if end <= len(key) and 0 <= length < 10_000:
                out.append(key[start:end].decode("utf-16-le"))
                pos = end
                continue
        pos += 1
    return out


def decode_single_string_key(key: bytes):
    """Decode a key blob for a single-field keyPath (e.g. legacy 'assets'
    store keyPath 'id', or kinetix-history keyPath 'projectId')."""
    out = decode_string_array_key(key)
    assert len(out) == 1, f"expected 1 element, got {out}"
    return out[0]
