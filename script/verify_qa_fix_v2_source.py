#!/usr/bin/env python3
"""Verify source contracts introduced by HealthPay QA Fix V2."""
import argparse
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise SystemExit(f"QA-FIX-V2-SOURCE: RED — {message}")


def flatten(value, prefix=""):
    out = {}
    if isinstance(value, dict):
        for key, child in value.items():
            name = f"{prefix}.{key}" if prefix else key
            out.update(flatten(child, name))
    else:
        out[prefix] = value
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--location", required=True)
    ap.add_argument("--product", required=True)
    ap.add_argument("--arabic", required=True)
    ap.add_argument("--repos-dir", required=True)
    args = ap.parse_args()

    location = Path(args.location)
    product = Path(args.product)
    arabic = Path(args.arabic)
    repos = Path(args.repos_dir)

    location_form = (location / "src/components/EditLocationDialog.js").read_text(encoding="utf-8")
    require(
        'getConf("fe-location", "locationForm.codeMaxLength", 50)' in location_form,
        "location code default is not the backend/schema limit of 50",
    )
    require(
        'getConf("fe-location", "locationForm.codeMaxLength", 8)' not in location_form,
        "legacy eight-character location limit remains",
    )

    picker = (product / "src/pickers/ProductPicker.js").read_text(encoding="utf-8")
    panel = (product / "src/components/ProductForm/MainPanelForm.js").read_text(encoding="utf-8")
    require("helperText," in picker and "helperText={helperText}" in picker, "ProductPicker helper-text contract missing")
    require('withLabel' in panel, "conversion program is not explicitly labelled")
    require('label={formatMessage("conversionProduct")}' in panel, "conversion-program label missing")
    require('helperText={formatMessage("conversionProductHelp")}' in panel, "conversion-program explanation missing")

    limits = (product / "src/components/ProductForm/DeductiblesCeilingsTabForm.js").read_text(encoding="utf-8")
    require("const inputAriaLabel" in limits, "product table ARIA-label helper missing")
    require(
        limits.count('"aria-label": inputAriaLabel(') == 23,
        "not all 23 deductible/ceiling NumberInputs have localized ARIA labels",
    )

    en = flatten(json.loads((product / "src/translations/en.json").read_text(encoding="utf-8")))
    ar = flatten(json.loads((arabic / "src/translations/ar.json").read_text(encoding="utf-8")))
    required_en = {
        "product.lumpSum": "Lump Sum (EGP)",
        "product.premiumAdult": "Adult Contribution (EGP)",
        "product.premiumChild": "Child Contribution (EGP)",
        "product.maxInstallments": "Max Installments (count)",
        "product.renewalDiscountPeriod": "Renewal Discount Period (months)",
        "product.renewalDiscountPerc": "Renewal Discount (%)",
        "product.enrolmentDiscountPeriod": "Enrolment Discount Period (months)",
        "product.enrolmentDiscountPerc": "Enrolment Discount (%)",
        "product.gracePeriodEnrolment": "Enrolment Grace Period (months)",
        "product.gracePeriodRenewal": "Renewal Grace Period (months)",
        "product.gracePeriodPayment": "Payment Grace Period (months)",
        "product.maxMembers": "Max members (count)",
        "product.DeductiblesCeilingsTabForm.DeductiblesTable.deductible": "Deductible (EGP)",
        "product.DeductiblesCeilingsTabForm.DeductiblesTable.ceiling": "Ceiling (EGP)",
        "product.DeductiblesCeilingsTabForm.MaxTable.ceiling": "Ceiling (EGP)",
        "product.ageMinimal": "Minimum Age (years)",
        "product.ageMaximal": "Maximum Age (years)",
        "product.FormMainPanel.conversionProduct": "Conversion coverage program",
    }
    required_ar = {
        "product.lumpSum": "المبلغ الإجمالي (ج.م)",
        "product.premiumAdult": "اشتراك البالغ (ج.م)",
        "product.premiumChild": "اشتراك الطفل (ج.م)",
        "product.maxInstallments": "الحد الأقصى للأقساط (عدد)",
        "product.renewalDiscountPeriod": "مدة خصم التجديد (أشهر)",
        "product.renewalDiscountPerc": "نسبة خصم التجديد (%)",
        "product.enrolmentDiscountPeriod": "مدة خصم الاشتراك (أشهر)",
        "product.enrolmentDiscountPerc": "نسبة خصم الاشتراك (%)",
        "product.gracePeriodEnrolment": "فترة السماح للاشتراك (أشهر)",
        "product.gracePeriodRenewal": "فترة السماح للتجديد (أشهر)",
        "product.gracePeriodPayment": "فترة السماح للسداد (أشهر)",
        "product.maxMembers": "الحد الأقصى لأفراد الأسرة (عدد)",
        "product.DeductiblesCeilingsTabForm.DeductiblesTable.deductible": "مبلغ التحمل (ج.م)",
        "product.DeductiblesCeilingsTabForm.DeductiblesTable.ceiling": "الحد الأقصى (ج.م)",
        "product.DeductiblesCeilingsTabForm.MaxTable.ceiling": "الحد الأقصى (ج.م)",
        "product.ageMinimal": "الحد الأدنى للعمر (سنوات)",
        "product.ageMaximal": "الحد الأقصى للعمر (سنوات)",
        "product.FormMainPanel.conversionProduct": "برنامج التغطية البديل",
    }
    for key, value in required_en.items():
        require(en.get(key) == value, f"English unit/help contract mismatch for {key}")
    for key, value in required_ar.items():
        require(ar.get(key) == value, f"Arabic unit/help contract mismatch for {key}")
    require(bool(ar.get("product.FormMainPanel.conversionProductHelp")), "Arabic conversion-program help missing")
    require(bool(en.get("product.FormMainPanel.conversionProductHelp")), "English conversion-program help missing")

    v2_contract = json.loads((arabic / "script/qa_fix_v2_keys.json").read_text(encoding="utf-8"))
    require(len(v2_contract) == 773, f"V2 key contract count is {len(v2_contract)}, expected 773")
    require(len(set(v2_contract)) == 773, "V2 key contract contains duplicates")
    require(all(key in ar for key in v2_contract), "one or more V2 Arabic keys are missing")

    measured = set()
    for path in repos.glob("*/src/translations/en.json"):
        measured.update(flatten(json.loads(path.read_text(encoding="utf-8"))))
    require(all(key in measured for key in v2_contract), "one or more V2 keys do not exist in measured English catalogs")

    print("QA-FIX-V2-SOURCE: GREEN")
    print("location_code_max=50")
    print("v2_arabic_contract=773/773")
    print(f"product_unit_contract={len(required_en)}/{len(required_en)}")
    print("product_numeric_aria_labels=23/23")


if __name__ == "__main__":
    main()
