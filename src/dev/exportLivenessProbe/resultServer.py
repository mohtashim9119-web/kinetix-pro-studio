#!/usr/bin/env python3
"""Throwaway Round 2 result collector + Tauri autorun flag. Not production."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import sys

OUT = Path("/tmp/ws3-export-liveness-result.jsonl")
AUTORUN = Path("/tmp/ws3-autorun.flag")
HOST, PORT = "127.0.0.1", 8799

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/ws3-autorun":
            body = b"run" if AUTORUN.exists() else b"skip"
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with OUT.open("ab") as f:
            f.write(raw + b"\n")
        try:
            obj = json.loads(raw.decode("utf-8", "replace"))
            tag = obj.get("tag", "?")
        except Exception:
            tag = "?"
        sys.stderr.write("saved tag=%s bytes=%d -> %s\n" % (tag, len(raw), OUT))
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

if __name__ == "__main__":
    HTTPServer((HOST, PORT), H).serve_forever()
