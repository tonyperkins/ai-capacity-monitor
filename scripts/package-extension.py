#!/usr/bin/env python3
"""Build a deterministic Chrome Web Store ZIP of the extension.

Only shipped files are included, entries are written in sorted order, and
every entry gets a fixed timestamp and mode, so packaging the same commit
twice always produces a byte-identical archive.

The SHIPPED list is a strict manifest: a new file in apps/extension that is
neither shipped nor excluded fails the build, so the list can't silently
drift out of date.
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "apps", "extension")
SHIPPED = [
    "manifest.json",
    "background.js",
    "providers.js",
    "formatting.js",
    "strings.js",
    "assets/icon-16.png",
    "assets/icon-32.png",
    "assets/icon-48.png",
    "assets/icon-128.png",
    "publishing.js",
    "permissions.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "options.html",
    "options.css",
    "options.js",
    "onboarding.html",
    "onboarding.css",
    "onboarding.js",
]
EXCLUDED = {"assets", "tests", "package.json", "README.md", "node_modules"}
FIXED_DATE = (2000, 1, 1, 0, 0, 0)


def main():
    present = set(os.listdir(SRC))
    missing = [name for name in SHIPPED if not os.path.isfile(os.path.join(SRC, name))]
    if missing:
        sys.exit(f"error: shipped files missing from {SRC}: {', '.join(missing)}")
    unaccounted = present - set(SHIPPED) - EXCLUDED
    if unaccounted:
        sys.exit(
            "error: files in apps/extension are neither shipped nor excluded: "
            f"{', '.join(sorted(unaccounted))}\n"
            "Add each one to SHIPPED or EXCLUDED in scripts/package-extension.py."
        )

    with open(os.path.join(SRC, "manifest.json")) as fh:
        version = json.load(fh)["version"]
    out_dir = os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"capacity-monitor-extension-v{version}.zip")

    with zipfile.ZipFile(out_path, "w") as archive:
        for name in sorted(SHIPPED):
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            info.external_attr = 0o644 << 16
            with open(os.path.join(SRC, name), "rb") as fh:
                archive.writestr(info, fh.read(), zipfile.ZIP_DEFLATED)
    print(out_path)


if __name__ == "__main__":
    main()
