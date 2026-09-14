#!/usr/bin/env python3
"""Positive and negative controls for the policy-renewal null-premium verifier."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def run(verifier, policy, backend, commit):
    return subprocess.run(
        [
            "python3",
            str(verifier),
            "--policy-repo",
            str(policy),
            "--backend-repo",
            str(backend),
            "--expected-policy-commit",
            commit,
        ],
        capture_output=True,
        text=True,
    )


def require(condition, message):
    if not condition:
        raise SystemExit(f"POLICY-RENEWAL-NULL-PREMIUM-CONTROLS: RED — {message}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy-repo", required=True)
    parser.add_argument("--backend-repo", required=True)
    parser.add_argument("--expected-policy-commit", required=True)
    args = parser.parse_args()

    verifier = Path(__file__).with_name("verify_policy_renewal_null_premium.py")
    policy = Path(args.policy_repo)
    backend = Path(args.backend_repo)

    positive = run(verifier, policy, backend, args.expected_policy_commit)
    require(positive.returncode == 0, f"positive control failed: {positive.stdout}{positive.stderr}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        policy_copy = temp / "policy"
        backend_copy = temp / "backend"
        shutil.copytree(policy, policy_copy, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        shutil.copytree(backend, backend_copy, ignore=shutil.ignore_patterns(".git", "__pycache__"))

        report_path = policy_copy / "policy/reports/policy_renewals.py"
        report = report_path.read_text(encoding="utf-8")
        report_path.write_text(
            report.replace("        if amount is None:\n            amount = 0\n", "", 1),
            encoding="utf-8",
        )
        missing_guard = run(verifier, policy_copy, backend_copy, args.expected_policy_commit)
        require(missing_guard.returncode != 0, "missing null guard was not detected")

        shutil.rmtree(policy_copy)
        shutil.copytree(policy, policy_copy, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        tests_path = policy_copy / "policy/tests/tests_reports.py"
        tests = tests_path.read_text(encoding="utf-8")
        tests_path.write_text(
            tests.replace('        self.assertIsNone(data[0]["amount"])\n', "", 1),
            encoding="utf-8",
        )
        missing_preservation = run(verifier, policy_copy, backend_copy, args.expected_policy_commit)
        require(missing_preservation.returncode != 0, "missing row-preservation assertion was not detected")

        assembly_path = backend_copy / "openimis.json"
        assembly = json.loads(assembly_path.read_text(encoding="utf-8"))
        for module in assembly["modules"]:
            if module.get("name") == "policy":
                module["pip"] = module["pip"].rsplit("@", 1)[0] + "@" + "0" * 40
        assembly_path.write_text(json.dumps(assembly, indent=2) + "\n", encoding="utf-8")
        wrong_pin = run(verifier, policy_copy, backend_copy, args.expected_policy_commit)
        require(wrong_pin.returncode != 0, "wrong backend policy pin was not detected")

    print("POLICY-RENEWAL-NULL-PREMIUM-CONTROLS: GREEN")
    print("positive_control=passed")
    print("negative_missing_guard=red")
    print("negative_missing_preservation_assertion=red")
    print("negative_wrong_pin=red")


if __name__ == "__main__":
    main()
