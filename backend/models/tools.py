"""
tools.py — Deterministic Actuarial Tool Functions
All calculations that should NOT be done by an LLM.
These run in Python and return exact numbers to feed into agent prompts.
"""
import numpy as np


# ── Environment Sensitivity Lookup (deterministic, per method) ─────────────
SENSITIVITY_TABLE = {
    "CL": {
        "changing_product_mix":        {"impact": "SEVERE",   "explanation": "Historical LDFs are calibrated to the old mix. If a longer-tail line grows faster, the LDFs are too low for the new mix, causing both reported and paid methods to significantly understate ultimate claims and IBNR."},
        "increasing_claim_ratios":     {"impact": "NONE",     "explanation": "Chain Ladder is highly responsive. It multiplies actual paid/reported claims by historical factors, so it automatically and accurately adapts to deteriorating loss experience without manual adjustment."},
        "case_outstanding_strengthening": {"impact": "SEVERE","explanation": "Reported CL suffers a double-leveraging effect: the latest diagonal inflates AND the age-to-age factors rise together, massively overstating ultimate. Paid CL is completely unaffected since it ignores case reserves."},
        "changing_settlement_rates":   {"impact": "SEVERE",   "explanation": "A speed-up in payments means historical paid factors (calibrated to slower speeds) are applied to artificially high paid amounts, systematically overstating ultimate claims."}
    },
    "MCL": {
        "changing_product_mix":        {"impact": "SEVERE",   "explanation": "Mack Chain Ladder inherits all CL distortions under a product mix shift. LDFs are too low for the new mix; both reported and paid projections understate IBNR. The standard error output also becomes unreliable."},
        "increasing_claim_ratios":     {"impact": "NONE",     "explanation": "Highly responsive — same as CL. Actual claims drive the projection. Additionally, the Mack variance estimates widen appropriately to signal increased uncertainty."},
        "case_outstanding_strengthening": {"impact": "SEVERE","explanation": "Same double-leveraging as CL on the reported side. The variance output is further distorted because sigma-squared estimates are inflated by the artificial reserve strengthening."},
        "changing_settlement_rates":   {"impact": "SEVERE",   "explanation": "Speed-up in payments distorts paid LDFs upward. The Mack model's standard error output will also be inflated, giving a false impression of high variance when the true issue is a structural change."}
    },
    "BF": {
        "changing_product_mix":        {"impact": "MODERATE", "explanation": "BF falls short because the a priori expected claim ratio is not automatically updated for the changing mix or lengthening reporting patterns. Both reported and paid BF will produce lower IBNR than actual."},
        "increasing_claim_ratios":     {"impact": "MODERATE", "explanation": "Partially unresponsive. The actual claims portion of the BF formula reacts, but the expected claims portion relies on a predetermined ratio that doesn't auto-update. Paid BF understates more than reported BF."},
        "case_outstanding_strengthening": {"impact": "MODERATE","explanation": "Reported BF overstates IBNR but less than CL — the expected claims base remains stable, avoiding double-leveraging. Paid BF is completely unaffected by case reserve changes."},
        "changing_settlement_rates":   {"impact": "MODERATE", "explanation": "The actual paid claims portion reacts to the accelerated payments, but the expected unreported portion may not compensate appropriately, creating a partial distortion."}
    },
    "CC": {
        "changing_product_mix":        {"impact": "MODERATE", "explanation": "Understates IBNR. Even though reported claims increase, the used-up premium calculation fails to correctly adjust for the changing reporting patterns of the new mix, skewing the derived ELR."},
        "increasing_claim_ratios":     {"impact": "NONE",     "explanation": "Highly responsive. Cape Cod derives its ELR dynamically from actual reported claims to date, so the expected claim ratio adjusts upward automatically and accurately tracks the deteriorating experience."},
        "case_outstanding_strengthening": {"impact": "SEVERE","explanation": "Severely overstates — even more than reported BF. The dynamically derived ELR inflates along with the rising development factors, compounding the error in both the numerator and denominator."},
        "changing_settlement_rates":   {"impact": "MODERATE", "explanation": "The dynamically derived ELR adjusts partially, but if the speed-up concentrates smaller claims at early maturities, average severity distortions remain and the used-up premium calculation is skewed."}
    },
    "BK": {
        "changing_product_mix":        {"impact": "SEVERE",   "explanation": "More prone to error than BF because Benktander gives greater credibility to the development method, which is itself distorted by the changing mix. Both reported and paid Benktander understate IBNR."},
        "increasing_claim_ratios":     {"impact": "SLIGHT",   "explanation": "More responsive than BF but less than CL. Because Benktander gives greater credibility to the development technique, it picks up more of the actual claim deterioration than the BF method alone."},
        "case_outstanding_strengthening": {"impact": "SEVERE","explanation": "More prone to error than BF because of heavier reliance on development factors, which inflate under reserve strengthening. The iterative structure amplifies the distortion in each subsequent iteration."},
        "changing_settlement_rates":   {"impact": "MODERATE", "explanation": "Similar to BF but with more weight on the development method, amplifying any paid-based distortions when settlement rates shift. Overstates ultimate if settlement speed increases."}
    },
    "CLK": {
        "changing_product_mix":        {"impact": "MODERATE", "explanation": "The fitted growth curve parameters are calibrated to the historical mix. A product mix shift may alter the shape of the development curve, reducing the reliability of the curve fit."},
        "increasing_claim_ratios":     {"impact": "NONE",     "explanation": "Responsive — the curve is fitted to actual paid data, so increasing volumes flow through to higher ultimate projections automatically."},
        "case_outstanding_strengthening": {"impact": "NONE",  "explanation": "Clark Stochastic uses paid claims only. Case reserve changes have no effect on the paid development curve or its parameters."},
        "changing_settlement_rates":   {"impact": "MODERATE", "explanation": "A structural shift in settlement speed changes the shape of the growth curve. The existing curve fit becomes mis-specified, requiring refitting with the new data pattern."}
    },
    "CO": {
        "changing_product_mix":        {"impact": "SLIGHT",   "explanation": "Case Outstanding method is less sensitive to mix shifts than development methods since it relies on adjuster-set case reserves rather than historical LDF patterns."},
        "increasing_claim_ratios":     {"impact": "NONE",     "explanation": "Directly responsive — higher claim activity immediately raises case reserves, which flows straight through to the Case Outstanding estimate."},
        "case_outstanding_strengthening": {"impact": "SEVERE","explanation": "Critically sensitive. The entire reserve estimate equals the case reserves. If adjusters strengthen reserves artificially, this method will overstate IBNR by exactly that amount with no dampening mechanism."},
        "changing_settlement_rates":   {"impact": "SLIGHT",   "explanation": "Faster settlements reduce open case counts and thus case reserves, directly lowering the IBNR estimate. This is broadly appropriate behavior unless large claims are disproportionately affected."}
    }
}


def get_environment_sensitivity(method_code: str) -> dict:
    """Return pre-computed sensitivity ratings for a given method. No LLM needed."""
    return SENSITIVITY_TABLE.get(method_code, {})


def compute_ibnr_table(triangle, model, custom_ldfs: list) -> list:
    """Return paid/ultimate/IBNR per accident year from a fitted model."""
    results = []
    diag = triangle.get_latest_diagonal()
    cdfs = triangle.compute_cdfs(custom_ldfs)
    model_results = model.get_results() if hasattr(model, 'get_results') else []

    for i, ay in enumerate(triangle.accident_years):
        paid = diag[i] if i < len(diag) else None
        # Use model result if available
        mr = next((r for r in model_results if str(r.get('accident_year')) == str(ay)), None)
        ultimate = mr['ultimate'] if mr else (round(paid * cdfs[i], 0) if paid and i < len(cdfs) else None)
        ibnr = round(ultimate - paid, 0) if ultimate is not None and paid is not None else None
        results.append({
            'accident_year': ay,
            'paid': round(paid, 0) if paid else None,
            'ultimate': round(ultimate, 0) if ultimate else None,
            'ibnr': ibnr
        })
    return results


def compute_loss_ratios(triangle, model_results: list) -> list:
    """Compute paid and ultimate loss ratios per AY when premium is available."""
    rows = []
    for r in model_results:
        ay = r['accident_year']
        prem = triangle.premiums.get(ay)
        if prem and prem > 0:
            paid_lr  = round(r['paid'] / prem * 100, 2) if r.get('paid') else None
            ult_lr   = round(r['ultimate'] / prem * 100, 2) if r.get('ultimate') else None
            rows.append({'accident_year': ay, 'premium': round(prem, 0),
                         'paid_lr_pct': paid_lr, 'ultimate_lr_pct': ult_lr})
    return rows


def suggest_elr(triangle) -> float | None:
    """
    Cape Cod derived ELR — the actuarially correct A Priori suggestion for BF/BK.
    Returns None if no premium data.
    """
    if not triangle.premiums:
        return None
    ldfs_raw = triangle.compute_ldfs()
    ldfs_list = [(r['volumeWeighted'] if r['volumeWeighted'] is not None else 1.0) for r in ldfs_raw[:-1]] + [1.0]
    cdfs = triangle.compute_cdfs(ldfs_list)
    diag = triangle.get_latest_diagonal()
    used_up = 0.0
    total_rep = 0.0
    for i, ay in enumerate(triangle.accident_years):
        prem = triangle.premiums.get(ay)
        paid = diag[i]
        dev_idx = next((j for j, v in reversed(list(enumerate(triangle.matrix[i]))) if v is not None), 0)
        cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
        pct_rep = 1.0 / cdf if cdf > 0 else 1.0
        if prem and paid is not None:
            used_up  += prem * pct_rep
            total_rep += paid
    return round(total_rep / used_up * 100, 2) if used_up > 0 else None


def compute_ldf_stability(triangle) -> list:
    """Compute CoV, credibility label, and VW vs SA deviation for each LDF column."""
    ldfs_raw = triangle.compute_ldfs()
    rows = []
    for r in ldfs_raw[:-1]:
        cov = r.get('cov', 0)
        n   = r.get('n', 0)
        vw  = r.get('volumeWeighted')
        sa  = r.get('straightAvg')
        rows.append({
            'from_age': r['fromAge'],
            'to_age':   r['toAge'],
            'vw':       round(vw, 4) if vw else None,
            'sa':       round(sa, 4) if sa else None,
            'cov_pct':  round(cov * 100, 2),
            'n':        n,
            'stability':    'High' if cov < 0.05 else ('Moderate' if cov < 0.15 else 'Low'),
            'credibility':  'Full' if n >= 5 else ('Partial' if n >= 3 else 'Thin'),
            'vw_sa_dev_pct': round(abs(vw - sa) / sa * 100, 2) if sa and sa > 0 and vw else None
        })
    return rows


def compute_tail_factor(custom_ldfs: list, triangle=None) -> dict:
    """
    Deterministically compute both tail candidates and return the chosen one.
    Priority: R-to-P Ratio > Curve Fit > Default 1.000
    """
    tail_rtp = None
    tail_curve = 1.000

    # Curve fit (exponential decay on last 3 development factors)
    try:
        ldfs_no_tail = custom_ldfs[:-1]
        if len(ldfs_no_tail) >= 3:
            y1, y2, y3 = ldfs_no_tail[-3]-1, ldfs_no_tail[-2]-1, ldfs_no_tail[-1]-1
            if 0 < y3 < y2 < y1:
                decay = ((y3/y2) + (y2/y1)) / 2
                if 0 < decay < 1:
                    tail_curve = round(1 + y3 * decay / (1 - decay), 4)
    except Exception:
        pass

    # Reported-to-Paid ratio
    try:
        if triangle and getattr(triangle, 'incurred_matrix', None) and triangle.matrix:
            oldest_inc = triangle.incurred_matrix[0][-1]
            oldest_pd  = triangle.matrix[0][-1]
            if oldest_inc and oldest_pd and oldest_pd > 0:
                rtp = round(oldest_inc / oldest_pd, 4)
                if rtp >= 1.0:
                    tail_rtp = rtp
    except Exception:
        pass

    if tail_rtp and tail_rtp > 1.0:
        chosen = tail_rtp
        reason = f"Reported-to-Paid Ratio ({tail_rtp})"
    elif tail_curve > 1.000:
        chosen = tail_curve
        reason = f"Exponential Curve Fit ({tail_curve})"
    else:
        chosen = 1.000
        reason = "Default (1.000) — LDFs fully converged, no residual tail detected"

    return {"chosen": chosen, "reason": reason,
            "rtp_candidate": tail_rtp, "curve_candidate": tail_curve}


def compute_suggested_elr(triangle, source: str = "paid") -> Optional[float]:
    """
    Suggested ELR hierarchy:
    1. Average mature accident year loss ratio (calculated using the selected source's losses)
    2. Chain Ladder ultimate / premium (for the selected source)
    3. Fallback: 65.0
    """
    if not triangle.premiums:
        return None

    try:
        # Determine mature accident years
        ldfs_raw = triangle.compute_ldfs() if source == "paid" else triangle.compute_incurred_ldfs()
        ldfs_list = [(r['volumeWeighted'] if r['volumeWeighted'] is not None else 1.0) for r in ldfs_raw[:-1]] + [1.0]
        cdfs = triangle.compute_cdfs(ldfs_list)
        
        if source == "incurred" and triangle.incurred_matrix:
            diag = [next((v for v in reversed(row) if v is not None), 0) for row in triangle.incurred_matrix]
            matrix_to_use = triangle.incurred_matrix
        else:
            diag = triangle.get_latest_diagonal()
            matrix_to_use = triangle.matrix
        
        # 1. Try average mature accident year loss ratio
        mature_lrs = []
        for i, ay in enumerate(triangle.accident_years):
            row = matrix_to_use[i]
            dev_idx = next((j for j, v in reversed(list(enumerate(row))) if v is not None), 0)
            cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
            dev_age = triangle.dev_ages[dev_idx] if dev_idx < len(triangle.dev_ages) else 0
            if cdf < 1.05 or dev_age >= 84:
                prem = triangle.premiums.get(ay, 0)
                paid = diag[i]
                if prem > 0 and paid is not None:
                    mature_lrs.append((paid * cdf) / prem)
                    
        if mature_lrs:
            return round(float(sum(mature_lrs) / len(mature_lrs)) * 100, 2)
            
        # 2. Try Chain Ladder ultimate / premium
        used_up = 0.0
        total_rep = 0.0
        for i, ay in enumerate(triangle.accident_years):
            prem = triangle.premiums.get(ay)
            paid = diag[i]
            row = matrix_to_use[i]
            dev_idx = next((j for j, v in reversed(list(enumerate(row))) if v is not None), 0)
            cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
            pct_rep = 1.0 / cdf if cdf > 0 else 1.0
            if prem and paid is not None:
                used_up  += prem * pct_rep
                total_rep += paid
        if used_up > 0:
            return round(total_rep / used_up * 100, 2)
            
    except Exception:
        pass
        
    return 65.0


def compute_mature_accident_years(triangle) -> dict:
    """
    Flag mature years when:
    CDF < 1.05 OR Development Age >= 84 months
    """
    mature_years = []
    reasons = {}
    try:
        ldfs_raw = triangle.compute_ldfs()
        ldfs_list = [(r['volumeWeighted'] if r['volumeWeighted'] is not None else 1.0) for r in ldfs_raw[:-1]] + [1.0]
        cdfs = triangle.compute_cdfs(ldfs_list)
        
        for i, ay in enumerate(triangle.accident_years):
            row = triangle.matrix[i]
            dev_idx = next((j for j, v in reversed(list(enumerate(row))) if v is not None), 0)
            cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
            dev_age = triangle.dev_ages[dev_idx] if dev_idx < len(triangle.dev_ages) else 0
            
            reasons_ay = []
            if cdf < 1.05:
                reasons_ay.append(f"CDF ({cdf:.3f}) < 1.05")
            if dev_age >= 84:
                reasons_ay.append(f"Development Age ({dev_age} mo) >= 84 mo")
                
            if reasons_ay:
                mature_years.append(ay)
                reasons[ay] = " and ".join(reasons_ay)
    except Exception:
        pass
        
    return {
        "mature_years": mature_years,
        "reasoning": reasons
    }


def compute_premium_availability(triangle) -> bool:
    return bool(triangle.premiums)


def compute_method_availability(triangle) -> dict:
    has_premium = compute_premium_availability(triangle)
    availability = {}
    for code in ["CL", "MCL", "CLK", "CO"]:
        availability[code] = {
            "available": True,
            "reason": None
        }
    for code in ["BF", "BK", "CC", "ELR"]:
        availability[code] = {
            "available": has_premium,
            "reason": None if has_premium else "Missing Earned Premium"
        }
    return availability

