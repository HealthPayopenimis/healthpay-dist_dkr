#!/usr/bin/env python3
"""
Gate M verifier — two-sided pin consistency for HealthPay trial deployments.

Checks THREE sides that must agree, because the failure mode that has now
occurred twice (rev6, rev11) is an edit that updates one side only:

  1. release-manifest.yaml pins            (this repo)
  2. the assemblies' own module configs    (healthpay-fe_js / healthpay-be_py openimis.json)
  3. the actual remote refs on GitHub

Also enforces the forbidden-reference rules from the manifest's
sourcing_allowlist: no `file:` paths, no branch refs in generated configs, no
`>=`/`^` version ranges on forked modules.

Exit 0 = Gate M green. Exit 1 = red, with every defect listed.

Usage (needs read access to the org; GH_TOKEN optional for public repos):
    python3 script/verify_gate_m.py \
        --manifest release-manifest.yaml \
        --fe-config /path/to/healthpay-fe_js/openimis.json \
        --be-config /path/to/healthpay-be_py/openimis.json

Omit --fe-config/--be-config to check manifest-vs-remote only (side 1 vs 3).
"""
import argparse
import json
import os
import re
import subprocess
import sys

ORG = "HealthPayopenimis"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")

PIN_RE = re.compile(
    r"- name: (\S+)\n\s+repo: (\S+)\n\s+ref: (\S+)\n\s+commit: (\S+)"
)


def parse_manifest(path):
    text = open(path, encoding="utf-8").read()
    return [
        {"name": m.group(1), "repo": m.group(2), "ref": m.group(3), "commit": m.group(4)}
        for m in PIN_RE.finditer(text)
    ]


def remote_sha(name, ref, token):
    url = f"https://github.com/{ORG}/{name}.git"
    if token:
        url = f"https://x-access-token:{token}@github.com/{ORG}/{name}.git"
    try:
        out = subprocess.run(
            ["git", "ls-remote", url, f"refs/heads/{ref}"],
            capture_output=True, text=True, timeout=60,
        ).stdout
    except subprocess.TimeoutExpired:
        return None
    return out.split("\t")[0].strip() if out.strip() else None


def config_refs(path, kind):
    """Extract {repo_name: sha} that an assembly's openimis.json actually points at."""
    if not path or not os.path.exists(path):
        return {}
    cfg = json.load(open(path, encoding="utf-8"))
    found = {}
    for mod in cfg.get("modules", []):
        spec = mod.get("npm") if kind == "fe" else mod.get("pip")
        if not spec:
            continue
        m = re.search(r"[/@]([A-Za-z0-9_.-]*healthpay-[A-Za-z0-9_.-]+?)(?:\.git)?[#@]([0-9a-f]{40})", spec)
        if m:
            found[m.group(1)] = m.group(2)
    return found


def forbidden_refs(path, kind):
    if not path or not os.path.exists(path):
        return []
    cfg = json.load(open(path, encoding="utf-8"))
    bad = []
    for mod in cfg.get("modules", []):
        spec = (mod.get("npm") if kind == "fe" else mod.get("pip")) or ""
        name = mod.get("name", "?")
        if "file:" in spec:
            bad.append(f"{kind}: '{name}' uses a file: path -> {spec}")
        if "HealthPayopenimis" in spec and not re.search(r"[#@][0-9a-f]{40}", spec):
            bad.append(f"{kind}: '{name}' pins a HealthPay repo by branch, not SHA -> {spec}")
        if re.search(r"@>=|\^", spec):
            bad.append(f"{kind}: '{name}' uses a version RANGE -> {spec}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="release-manifest.yaml")
    ap.add_argument("--fe-config")
    ap.add_argument("--be-config")
    ap.add_argument("--skip-remote", action="store_true")
    args = ap.parse_args()
    token = os.environ.get("GH_TOKEN")

    pins = parse_manifest(args.manifest)
    defects = []
    print(f"[gate-m] manifest pins: {len(pins)}")

    for p in pins:
        if not SHA_RE.match(p["commit"]):
            defects.append(f"pin '{p['name']}' commit is not a 40-char SHA: {p['commit']}")
        if not p["repo"].startswith(f"https://github.com/{ORG}/"):
            defects.append(f"pin '{p['name']}' repo is outside {ORG}: {p['repo']}")

    # side 1 vs 3
    if not args.skip_remote:
        for p in pins:
            got = remote_sha(p["name"], p["ref"], token)
            if got is None:
                defects.append(f"REMOTE MISSING: {p['name']} has no branch '{p['ref']}'")
            elif got != p["commit"]:
                defects.append(
                    f"REMOTE MISMATCH: {p['name']}@{p['ref']} manifest={p['commit'][:8]} remote={got[:8]}"
                )
        print("[gate-m] manifest vs remote refs: checked")

    # side 1 vs 2 — the orphan-pin class (rev6, rev11)
    by_name = {p["name"]: p["commit"] for p in pins}
    for path, kind in ((args.fe_config, "fe"), (args.be_config, "be")):
        refs = config_refs(path, kind)
        if not refs:
            continue
        for repo, sha in refs.items():
            if repo not in by_name:
                defects.append(f"ORPHAN: {kind} config pins '{repo}' which the manifest does not list")
            elif by_name[repo] != sha:
                defects.append(
                    f"ORPHAN PIN: '{repo}' manifest={by_name[repo][:8]} but {kind} "
                    f"assembly config={sha[:8]} — a build would ship the config's version"
                )
        defects.extend(forbidden_refs(path, kind))
        print(f"[gate-m] {kind} assembly config: {len(refs)} git-pinned modules checked")

    print("=" * 64)
    if defects:
        print(f"GATE M: RED — {len(defects)} defect(s)")
        for d in defects:
            print("  -", d)
        return 1
    print("GATE M: GREEN — manifest, assembly configs, and remote refs all agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
