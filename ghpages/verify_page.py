#!/usr/bin/env python3
"""verify the enhanced gh-pages artifact: JS syntax, SVG XML, HTML structure, URLs."""
import html.parser
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

SRC = "/tmp/quilt-canvas/ghpages/index.html"
ALLOWED_EXTERNAL = {
    "https://github.com/SuperInstance/quilt-c.git",
    "https://github.com/SuperInstance/quilt-c/releases/download/v0.1.0/quilt_c99_kernel-0.1.0-py3-none-any.whl",
    "https://github.com/SuperInstance/quilt-c/releases/download/v0.1.0/quilt-c99-kernel-0.1.0.tar.gz",
    "https://github.com/SuperInstance/quilt-c/releases/download/v0.1.0/quilt-c99-kernel-0.1.0.tgz",
    "https://github.com/SuperInstance/quilt-c/releases/tag/v0.1.0",
    "https://github.com/SuperInstance/quilt-c",
    "https://github.com/SuperInstance/quilt-claude-charts/blob/main/QUILT_CHARTER.md",
}

with open(SRC) as fh:
    doc = fh.read()

results = {}

# 1. JS syntax check via node
scripts = re.findall(r"<script>(.*?)</script>", doc, re.S)
assert scripts, "no inline script found"
proc = subprocess.run(["node", "--check", "-"],
                      input=scripts[0], capture_output=True, text=True)
results["js_syntax"] = proc.returncode == 0
if proc.returncode != 0:
    print("JS ERROR:", proc.stderr[:800])

# 2. SVG well-formedness
svgs = re.findall(r"<svg.*?</svg>", doc, re.S)
results["svg_count"] = len(svgs) == 2
for i, s in enumerate(svgs):
    try:
        ET.fromstring(s)
    except ET.ParseError as e:
        results[f"svg_{i}_xml"] = False
        print(f"SVG {i} parse error:", e)
    else:
        results[f"svg_{i}_xml"] = True

# 3. HTML parses + canvas present
class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.canvases = 0
        self.scripts = 0
    def handle_starttag(self, tag, attrs):
        if tag == "canvas":
            self.canvases += 1
        if tag == "script":
            self.scripts += 1
p = P()
p.feed(doc)
results["html_canvas"] = p.canvases == 1
results["html_script"] = p.scripts >= 1

# 4. no unexpected external URLs
urls = set(re.findall(r'https?://[^\s"\'<>)]+', doc))
unexpected = {u for u in urls if u.rstrip("/") not in {a.rstrip("/") for a in ALLOWED_EXTERNAL}
              and "www.w3.org" not in u}
results["urls_clean"] = not unexpected
if unexpected:
    print("UNEXPECTED URLS:", unexpected)

# 5. spine sections present
for marker in ["The check", "The honest part", "What I am not asking you to do",
               "1285 passed / 0 failed", "receipt_sha256", "The rest of the substrate",
               "The fabric, live", "BIND(cell, dials)"]:
    results[f"spine:{marker[:24]}"] = marker in doc

print("ghpages verification:")
bad = 0
for k, v in results.items():
    if not v:
        bad += 1
    print(f"  [{'PASS' if v else 'FAIL'}] {k}")
print(f"  -> {'ALL GREEN' if bad == 0 else str(bad) + ' RED'}")
sys.exit(0 if bad == 0 else 2)
