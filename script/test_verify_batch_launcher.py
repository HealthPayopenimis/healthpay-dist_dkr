#!/usr/bin/env python3
"""Exercise verify_batch_launcher.py with positive and negative fixtures."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

VERIFIER = Path(__file__).resolve().parent / "verify_batch_launcher.py"


def run(claim_batch, arabic_pack):
    return subprocess.run(
        [
            sys.executable,
            str(VERIFIER),
            "--claim-batch",
            str(claim_batch),
            "--arabic-pack",
            str(arabic_pack),
        ],
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
    parser.add_argument("--claim-batch", required=True)
    parser.add_argument("--arabic-pack", required=True)
    args = parser.parse_args()

    claim_batch = Path(args.claim_batch)
    arabic_pack = Path(args.arabic_pack)
    expect(run(claim_batch, arabic_pack), 0, "BATCH-LAUNCHER: GREEN", "positive-control")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_root = Path(tmp)
        claim_copy = tmp_root / "claim-batch"
        arabic_copy = tmp_root / "arabic-pack"
        (claim_copy / "src" / "components").mkdir(parents=True)
        (claim_copy / "src" / "translations").mkdir(parents=True)
        (arabic_copy / "src" / "translations").mkdir(parents=True)
        shutil.copy2(
            claim_batch / "src" / "components" / "BatchRunLauncher.js",
            claim_copy / "src" / "components" / "BatchRunLauncher.js",
        )
        shutil.copy2(
            claim_batch / "src" / "translations" / "en.json",
            claim_copy / "src" / "translations" / "en.json",
        )
        shutil.copy2(
            arabic_pack / "src" / "translations" / "ar.json",
            arabic_copy / "src" / "translations" / "ar.json",
        )

        launcher_path = claim_copy / "src" / "components" / "BatchRunLauncher.js"
        launcher_path.write_text(
            launcher_path.read_text(encoding="utf-8").replace("disabled={!this.canLaunch()}", "disabled={false}", 1),
            encoding="utf-8",
        )
        expect(
            run(claim_copy, arabic_copy),
            1,
            "missing existing enablement",
            "enablement-negative-control",
        )

        shutil.copy2(
            claim_batch / "src" / "components" / "BatchRunLauncher.js",
            launcher_path,
        )
        launcher_path.write_text(
            launcher_path.read_text(encoding="utf-8").replace(
                'aria-label={formatMessage(intl, "claim_batch", "BatchRunLauncher.launchButton.tooltip")}',
                'data-action-label="removed-for-negative-control"',
                1,
            ),
            encoding="utf-8",
        )
        expect(
            run(claim_copy, arabic_copy),
            1,
            "missing accessible label",
            "accessibility-negative-control",
        )

    print("BATCH-LAUNCHER-CONTROLS: GREEN")


if __name__ == "__main__":
    main()
