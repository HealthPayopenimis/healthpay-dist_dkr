#!/usr/bin/env python3
"""Exercise verify_public_locale.py with positive and negative fixtures."""
import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile

VERIFIER = pathlib.Path(__file__).resolve().parent / "verify_public_locale.py"


def run(assembly, core):
    return subprocess.run(
        [sys.executable, str(VERIFIER), "--fe-assembly", str(assembly), "--fe-core", str(core)],
        check=False,
        text=True,
        capture_output=True,
    )


def expect(result, code, snippet, label):
    output = result.stdout + result.stderr
    if result.returncode != code or snippet not in output:
        raise SystemExit(
            f"{label}: expected exit={code} and {snippet!r}, got exit={result.returncode}\n{output}"
        )
    print(f"{label}: GREEN")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fe-assembly", required=True)
    parser.add_argument("--fe-core", required=True)
    args = parser.parse_args()

    assembly = pathlib.Path(args.fe_assembly)
    core = pathlib.Path(args.fe_core)
    expect(run(assembly, core), 0, "PUBLIC-LOCALE: GREEN", "positive-control")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = pathlib.Path(tmp)
        assembly_copy = tmp_path / "assembly"
        core_copy = tmp_path / "core"
        (assembly_copy / "src").mkdir(parents=True)
        (core_copy / "src" / "components").mkdir(parents=True)
        shutil.copy2(assembly / "src" / "LocalesManager.js", assembly_copy / "src" / "LocalesManager.js")
        shutil.copy2(core / "src" / "components" / "App.js", core_copy / "src" / "components" / "App.js")

        locale_manager = assembly_copy / "src" / "LocalesManager.js"
        locale_manager.write_text(
            locale_manager.read_text(encoding="utf-8").replace('return "ar";', 'return "en";', 1),
            encoding="utf-8",
        )
        expect(
            run(assembly_copy, core_copy),
            1,
            "does not declare Arabic",
            "wrong-default-negative-control",
        )

        shutil.copy2(assembly / "src" / "LocalesManager.js", locale_manager)
        app = core_copy / "src" / "components" / "App.js"
        app.write_text(
            app.read_text(encoding="utf-8").replace(
                "cookieLang || publicDefaultLanguage || localesManager.getFileNameByLang(navigator.language)",
                "publicDefaultLanguage || cookieLang || localesManager.getFileNameByLang(navigator.language)",
                1,
            ),
            encoding="utf-8",
        )
        expect(
            run(assembly_copy, core_copy),
            1,
            "public locale precedence",
            "precedence-negative-control",
        )

    print("PUBLIC-LOCALE-CONTROLS: GREEN")


if __name__ == "__main__":
    main()
