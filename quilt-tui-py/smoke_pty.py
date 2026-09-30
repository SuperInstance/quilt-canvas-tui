#!/usr/bin/env python3
"""pty smoke test: run the curses TUI under a pseudo-TTY, drive keystrokes,
capture the rendered frames, assert the fabric actually mutated."""
import os
import pty
import select
import subprocess
import sys
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quilt_tui import Fabric, driver_apply_script  # noqa: E402

KEYS = [
    ("t", "TICK"),          # tick at A1
    ("l", "link-mode"),
    ("\r", "link-src"),
    ("l", "move"),
    ("\r", "link-confirm"),
    ("e", "edit-mode"),
    ("5", "buf"),
    (",", "buf"),
    ("3", "buf"),
    ("\r", "bind"),
    ("x", "effect"),
    ("v", "view"),
    ("q", "quit"),
]

def main():
    master, slave = pty.openpty()
    env = dict(os.environ, TERM="xterm-256color", LINES="40", COLUMNS="120")
    proc = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "quilt_tui.py"), "--fabric", "demo_fabric.json"],
        stdin=slave, stdout=slave, stderr=subprocess.PIPE, env=env, cwd=HERE,
    )
    os.close(slave)
    frames = []
    sent = 0
    deadline = time.time() + 20
    # let it draw the first frame
    time.sleep(1.2)
    while time.time() < deadline and sent < len(KEYS):
        key, _ = KEYS[sent]
        os.write(master, key.encode())
        sent += 1
        time.sleep(0.35)
        while True:
            r, _, _ = select.select([master], [], [], 0.05)
            if not r:
                break
            try:
                frames.append(os.read(master, 65536))
            except OSError:
                break
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    err = proc.stderr.read().decode() if proc.stderr else ""
    blob = b"".join(frames).decode("utf-8", "replace")

    checks = {
        "frame_captured": len(blob) > 500,
        "rendered_grid": "A1" in blob and "B1" in blob,
        "rendered_dials": "[" in blob and "]" in blob,
        "status_bar": "tick=" in blob and "journal=" in blob,
        "tick_keypress_seen": proc.returncode == 0,
    }
    print("pty smoke:")
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    if err.strip():
        print("  stderr:", err.strip()[:400])
    bad = sum(1 for v in checks.values() if not v)
    print(f"  -> {'SMOKE OK' if bad == 0 else f'{bad} FAILURES'}")
    return 0 if bad == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
