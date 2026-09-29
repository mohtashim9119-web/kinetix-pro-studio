#!/usr/bin/env python3
"""Mint or revoke a gateway API key for one team member (operator D1).

    python cloud/mint_key.py mint <member>     # writes cloud/.keys/<member>.key
    python cloud/mint_key.py revoke <member>
    python cloud/mint_key.py list

The raw key is written once to `cloud/.keys/<member>.key` (gitignored, mode
0600) for handover and is never printed. `cloud/.keys/registry.json` keeps
{member: sha256} and is pushed to the Modal Secret `kinetix-gateway-keys` as
{sha256: member} — the secret never holds a usable credential. Redeploy is
not needed: the gateway reads the secret when a container starts, so a new
key works once the current gateway container scales down (<= 60 s idle).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

import sync_core as core

KEYS_DIR = Path(__file__).resolve().parent / ".keys"
REGISTRY = KEYS_DIR / "registry.json"
SECRET_NAME = "kinetix-gateway-keys"
MEMBER_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def modal_bin() -> str:
    return os.environ.get("MODAL_BIN", "modal")


def load_registry() -> dict[str, str]:
    return json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {}


def save_registry(registry: dict[str, str]) -> None:
    KEYS_DIR.mkdir(mode=0o700, exist_ok=True)
    REGISTRY.write_text(json.dumps(registry, indent=2, sort_keys=True), encoding="utf-8")


def push_secret(registry: dict[str, str]) -> None:
    by_digest = {digest: member for member, digest in registry.items()}
    subprocess.run(
        [modal_bin(), "secret", "create", SECRET_NAME, f"KINETIX_GATEWAY_KEYS={json.dumps(by_digest)}", "--force"],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["mint", "revoke", "list"])
    parser.add_argument("member", nargs="?")
    args = parser.parse_args()
    registry = load_registry()

    if args.action == "list":
        for member in sorted(registry):
            print(member)
        return
    if not args.member or not MEMBER_RE.match(args.member):
        sys.exit("member must be lowercase letters, digits, '-' or '_' (max 32)")

    if args.action == "mint":
        key = f"kx_{secrets.token_urlsafe(32)}"
        registry[args.member] = core.sha256_hex(key)
        save_registry(registry)
        key_path = KEYS_DIR / f"{args.member}.key"
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(key + "\n")
        push_secret(registry)
        print(f"minted key for {args.member}: {key_path}")
    else:
        if registry.pop(args.member, None) is None:
            sys.exit(f"no key for {args.member}")
        save_registry(registry)
        (KEYS_DIR / f"{args.member}.key").unlink(missing_ok=True)
        push_secret(registry)
        print(f"revoked {args.member}")


if __name__ == "__main__":
    main()
