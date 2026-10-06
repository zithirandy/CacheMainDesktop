"""Seed and verify the local memcached test server.

Usage:  python scripts/test-memcached-seed.py [host] [port]

Speaks the memcached text protocol directly, so it needs no client library.
Used to put known keys into the docker test server before driving the
dashboard against it.
"""

import socket
import sys

HOST = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 11211


def connect():
    return socket.create_connection((HOST, PORT), timeout=5)


def send_all(sock, payload):
    """Send a payload and read one reply (up to the terminating CRLF)."""
    sock.sendall(payload)
    return sock.recv(4096).decode("utf-8", "replace")


def main():
    sock = connect()

    seeds = [
        (b"greeting", b"hello from memcached!", 0),
        (b"counter", b"42", 0),
        (b"session:abc", b"token-value", 600),
        (b"user:1:name", b"Ada", 0),
        (b"config:flags", b'{"debug":false,"level":3}', 0),
    ]

    for key, value, ttl in seeds:
        cmd = b"set %s 0 %d %d\r\n%s\r\n" % (key, ttl, len(value), value)
        print(f"set {key.decode():<16} -> {send_all(sock, cmd).strip()!r}")

    # Read one back to prove the store works end to end.
    reply = send_all(sock, b"get greeting\r\n")
    print("get greeting     ->", repr(reply))

    stats = send_all(sock, b"stats\r\n")
    print("--- server stats ---")
    for line in stats.splitlines():
        if any(word in line for word in ("version", "curr_items", "total_items",
                                         "track_sizes", "limit_maxbytes", "cmd_get")):
            print(" ", line)

    sock.close()


if __name__ == "__main__":
    main()
