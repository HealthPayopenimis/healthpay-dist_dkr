#!/usr/bin/env python3
"""Verify the HealthPay Batch Run action remains functional and discoverable."""
import argparse
import json
from pathlib import Path
import sys

KEY = "claim_batch.BatchRunLauncher.launchButton.tooltip"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--claim-batch", required=True)
    parser.add_argument("--arabic-pack", required=True)
    args = parser.parse_args()

    claim_batch = Path(args.claim_batch)
    arabic_pack = Path(args.arabic_pack)
    launcher_path = claim_batch / "src" / "components" / "BatchRunLauncher.js"
    english_path = claim_batch / "src" / "translations" / "en.json"
    arabic_path = arabic_pack / "src" / "translations" / "ar.json"
    defects = []

    try:
        launcher = launcher_path.read_text(encoding="utf-8")
        english = json.loads(english_path.read_text(encoding="utf-8"))
        arabic = json.loads(arabic_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"BATCH-LAUNCHER: RED — cannot read source contract: {error}")
        return 1

    required_source = {
        "localized tooltip": f'<Tooltip title={{formatMessage(intl, "claim_batch", "BatchRunLauncher.launchButton.tooltip")}}>',
        "accessible label": f'aria-label={{formatMessage(intl, "claim_batch", "BatchRunLauncher.launchButton.tooltip")}}',
        "existing enablement": "disabled={!this.canLaunch()}",
        "existing launch action": "onClick={this.launchBatchRun}",
        "disabled-button tooltip wrapper": "<span>",
    }
    for label, snippet in required_source.items():
        if snippet not in launcher:
            defects.append(f"missing {label}")

    if english.get(KEY) != "Start periodic settlement":
        defects.append("English action label missing or changed")
    if arabic.get(KEY) != "بدء التسوية الدورية":
        defects.append("Arabic action label missing or changed")

    print("=" * 64)
    if defects:
        print(f"BATCH-LAUNCHER: RED — {len(defects)} defect(s)")
        for defect in defects:
            print("  -", defect)
        return 1
    print("BATCH-LAUNCHER: GREEN — tooltip, accessibility, enablement, action, and bilingual labels are intact")
    return 0


if __name__ == "__main__":
    sys.exit(main())
