#!/usr/bin/env python3
"""Verify the HealthPay policy-renewals null-premium report contract."""
import argparse
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise SystemExit(f"POLICY-RENEWAL-NULL-PREMIUM: RED — {message}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy-repo", required=True)
    parser.add_argument("--backend-repo", required=True)
    parser.add_argument("--expected-policy-commit", required=True)
    args = parser.parse_args()

    policy_repo = Path(args.policy_repo)
    backend_repo = Path(args.backend_repo)
    expected = args.expected_policy_commit
    require(len(expected) == 40, "expected policy commit is not a full SHA")

    report = (policy_repo / "policy/reports/policy_renewals.py").read_text(encoding="utf-8")
    tests = (policy_repo / "policy/tests/tests_reports.py").read_text(encoding="utf-8")
    assembly = json.loads((backend_repo / "openimis.json").read_text(encoding="utf-8"))

    require(
        'amount = policy["amount"]\n' in report
        and "if amount is None:\n            amount = 0" in report,
        "missing explicit null-to-zero subtotal guard",
    )
    require(
        'amount=F("premiums__amount")' in report,
        "report no longer preserves the premium amount in each row",
    )
    require(
        "test_null_premium_is_zero_for_subtotals_and_row_is_preserved" in tests,
        "null-premium row-preservation regression test missing",
    )
    require(
        'self.assertIsNone(data[0]["amount"])' in tests,
        "regression test no longer proves the displayed null amount is preserved",
    )
    require(
        "test_null_zero_and_normal_premiums_are_aggregated_together" in tests
        and 'Decimal("18.00")' in tests,
        "mixed null, zero, and normal premium subtotal test missing",
    )

    policy_modules = [module for module in assembly["modules"] if module.get("name") == "policy"]
    require(len(policy_modules) == 1, "backend assembly must contain exactly one policy module")
    pip_ref = policy_modules[0].get("pip", "")
    require(
        pip_ref.endswith(f"@{expected}"),
        "backend assembly policy pin does not match the expected immutable commit",
    )
    require("@hp-main" not in pip_ref and "@release/" not in pip_ref, "backend policy pin is a branch ref")

    print("POLICY-RENEWAL-NULL-PREMIUM: GREEN")
    print("null_subtotal_guard=present")
    print("null_report_row_preservation=tested")
    print("mixed_amount_total=tested")
    print(f"backend_policy_pin={expected}")


if __name__ == "__main__":
    main()
