#!/usr/bin/env python3
"""Verify HealthPay public and authenticated locale-selection contracts.

Usage:
    python3 script/verify_public_locale.py \
        --fe-assembly /path/to/healthpay-fe_js \
        --fe-core /path/to/healthpay-fe-core_js
"""
import argparse
import pathlib
import re
import sys


def compact(source):
    return re.sub(r"\s+", " ", source)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fe-assembly", required=True)
    parser.add_argument("--fe-core", required=True)
    args = parser.parse_args()

    assembly_file = pathlib.Path(args.fe_assembly) / "src" / "LocalesManager.js"
    core_file = pathlib.Path(args.fe_core) / "src" / "components" / "App.js"
    defects = []

    if not assembly_file.is_file():
        defects.append(f"missing assembly locale manager: {assembly_file}")
        assembly = ""
    else:
        assembly = compact(assembly_file.read_text(encoding="utf-8"))

    if not core_file.is_file():
        defects.append(f"missing core app: {core_file}")
        core = ""
    else:
        core = compact(core_file.read_text(encoding="utf-8"))

    if not re.search(r'getPublicDefaultLanguage\(\)\s*\{[^}]*return\s+["\']ar["\']\s*;', assembly):
        defects.append("assembly does not declare Arabic as the public default language")

    expected_precedence = re.compile(
        r'lang\s*=\s*cookieLang\s*\|\|\s*publicDefaultLanguage\s*\|\|\s*'
        r'localesManager\.getFileNameByLang\(navigator\.language\)\s*\|\|\s*["\']en["\']'
    )
    if not expected_precedence.search(core):
        defects.append("public locale precedence is not cookie -> assembly default -> browser -> English")

    if "localesManager.getFileNameByLang(user.language)" not in core:
        defects.append("authenticated user language selection is missing")

    if "localesManager.getPublicDefaultLanguage?.()" not in core:
        defects.append("core does not use the optional assembly public default")

    print("=" * 64)
    if defects:
        print(f"PUBLIC-LOCALE: RED — {len(defects)} defect(s)")
        for defect in defects:
            print("  -", defect)
        return 1
    print("PUBLIC-LOCALE: GREEN — cookie, Arabic default, browser fallback, English fallback, and user language are preserved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
