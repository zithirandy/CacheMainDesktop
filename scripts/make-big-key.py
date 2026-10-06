"""Create/clean the large-value key used to verify the O9 fix.

Usage:  python scripts/make-big-key.py [key] [bytes]

Speaks the Redis protocol directly so a 100KB value never has to survive a
command line (a shell-length limit is what defeated the earlier attempt).
"""

import socket
import sys

KEY = sys.argv[1] if len(sys.argv) > 1 else "o9test"
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 100_000
DB = 9


def encode(*args):
    out = b"*%d\r\n" % len(args)
    for arg in args:
        payload = arg if isinstance(arg, bytes) else str(arg).encode()
        out += b"$%d\r\n%s\r\n" % (len(payload), payload)
    return out


sock = socket.create_connection(("127.0.0.1", 6379), timeout=15)
sock.sendall(encode("SELECT", DB))
sock.recv(100)

sock.sendall(encode("SET", KEY, b"x" * SIZE))
print("SET   ->", sock.recv(100).decode(errors="replace").strip())

sock.sendall(encode("STRLEN", KEY))
print("STRLEN->", sock.recv(100).decode(errors="replace").strip())

sock.sendall(encode("EXISTS", KEY))
print("EXISTS->", sock.recv(100).decode(errors="replace").strip())

sock.close()
