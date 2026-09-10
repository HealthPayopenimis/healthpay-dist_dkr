#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "verify_qa_fix_v2_source.py"


def run(location, product, arabic, repos):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--location", str(location), "--product", str(product),
         "--arabic", str(arabic), "--repos-dir", str(repos)],
        text=True, capture_output=True, check=False,
    )


def expect(result, code, snippet, label):
    output = result.stdout + result.stderr
    if result.returncode != code or snippet not in output:
        raise SystemExit(f"{label}: expected code={code} snippet={snippet!r}\n{output}")
    print(f"{label}: GREEN")


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--location", required=True)
    ap.add_argument("--product", required=True)
    ap.add_argument("--arabic", required=True)
    ap.add_argument("--repos-dir", required=True)
    a=ap.parse_args()
    location,product,arabic,repos=map(Path,(a.location,a.product,a.arabic,a.repos_dir))
    expect(run(location,product,arabic,repos),0,"QA-FIX-V2-SOURCE: GREEN","positive-control")

    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp)
        loc=tmp/"location"; shutil.copytree(location,loc,ignore=shutil.ignore_patterns('.git','node_modules','build'))
        f=loc/"src/components/EditLocationDialog.js"
        f.write_text(f.read_text().replace('locationForm.codeMaxLength", 50','locationForm.codeMaxLength", 8'),encoding='utf-8')
        expect(run(loc,product,arabic,repos),1,"location code default","location-limit-negative-control")

        prod=tmp/"product"; shutil.copytree(product,prod,ignore=shutil.ignore_patterns('.git','node_modules','build'))
        f=prod/"src/pickers/ProductPicker.js"
        f.write_text(f.read_text().replace('            helperText={helperText}\n',''),encoding='utf-8')
        expect(run(location,prod,arabic,repos),1,"ProductPicker helper-text","conversion-help-negative-control")

        prod2=tmp/"product-unit"; shutil.copytree(product,prod2,ignore=shutil.ignore_patterns('.git','node_modules','build'))
        f=prod2/"src/translations/en.json"
        values=json.loads(f.read_text()); values['product.lumpSum']='Lump Sum'; f.write_text(json.dumps(values,indent=2)+'\n')
        expect(run(location,prod2,arabic,repos),1,"English unit/help contract mismatch","unit-label-negative-control")

        prod3=tmp/"product-aria"; shutil.copytree(product,prod3,ignore=shutil.ignore_patterns('.git','node_modules','build'))
        f=prod3/"src/components/ProductForm/DeductiblesCeilingsTabForm.js"
        text=f.read_text(); text=text.replace('"aria-label": inputAriaLabel(', '"aria-label": removedAriaLabel(', 1); f.write_text(text)
        expect(run(location,prod3,arabic,repos),1,"not all 23 deductible/ceiling","numeric-aria-negative-control")

        ar=tmp/"arabic"; shutil.copytree(arabic,ar,ignore=shutil.ignore_patterns('.git','node_modules','build'))
        f=ar/"src/translations/ar.json"
        values=json.loads(f.read_text()); del values['claim.claimedDate']; f.write_text(json.dumps(values,ensure_ascii=False,indent=2)+'\n')
        expect(run(location,product,ar,repos),1,"V2 Arabic keys are missing","v2-arabic-negative-control")

    print("QA-FIX-V2-SOURCE-CONTROLS: GREEN")

if __name__=="__main__": main()
