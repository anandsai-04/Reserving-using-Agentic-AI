"""
diagnostics.py — Actuarial Computed Metrics
Computes all derived actuarial statistics from a Triangle object.
"""
import numpy as np
from models.methods import curve_fit


def compute_diagnostics(triangle):
    diag = triangle.get_latest_diagonal()
    total_paid = sum(v for v in diag if v is not None and not np.isnan(v))
    ays = triangle.accident_years
    ldfs_raw = triangle.compute_ldfs()

    # ── 1. Loss Ratios by AY (if premium available) ──────────────────────────
    loss_ratios = []
    total_premium = 0.0
    if triangle.premiums:
        ldfs_list = [r['volumeWeighted'] for r in ldfs_raw[:-1]] + [1.0]
        cdfs = triangle.compute_cdfs(ldfs_list)
        for i, ay in enumerate(ays):
            prem = triangle.premiums.get(ay)
            paid_val = diag[i]
            if prem and prem > 0:
                total_premium += prem
                dev_idx = next((j for j, v in reversed(list(enumerate(triangle.matrix[i]))) if v is not None), 0)
                cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
                ultimate = round(paid_val * cdf, 2) if paid_val else None
                paid_lr = round(paid_val / prem * 100, 2) if paid_val else None
                ult_lr  = round(ultimate / prem * 100, 2) if ultimate else None
                loss_ratios.append({
                    'ay': ay,
                    'premium': round(prem, 0),
                    'paid': round(paid_val, 0) if paid_val else None,
                    'paid_lr_pct': paid_lr,
                    'estimated_ultimate': round(ultimate, 0) if ultimate else None,
                    'ultimate_lr_pct': ult_lr
                })

    # ── 2. Suggested A Priori ELR for BF/BK (Cape Cod Method) ────────────────
    suggested_elr = None
    if triangle.premiums and ldfs_raw:
        ldfs_list = [r['volumeWeighted'] for r in ldfs_raw[:-1]] + [1.0]
        cdfs = triangle.compute_cdfs(ldfs_list)
        used_up_prem = 0.0
        total_reported = 0.0
        for i, ay in enumerate(ays):
            prem = triangle.premiums.get(ay)
            paid_val = diag[i]
            dev_idx = next((j for j, v in reversed(list(enumerate(triangle.matrix[i]))) if v is not None), 0)
            cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
            pct_rep = 1.0 / cdf if cdf > 0 else 1.0
            if prem and paid_val is not None:
                used_up_prem += prem * pct_rep
                total_reported += paid_val
        if used_up_prem > 0:
            suggested_elr = round(total_reported / used_up_prem * 100, 2)

    # ── 3. LDF Stability Diagnostics ─────────────────────────────────────────
    ldf_diagnostics = []
    for row in ldfs_raw[:-1]:
        cov = row.get('cov', 0)
        n   = row.get('n', 0)
        vw  = row.get('volumeWeighted')
        sa  = row.get('straightAvg')
        stability   = 'High' if cov < 0.05 else ('Moderate' if cov < 0.15 else 'Low')
        credibility = 'Full' if n >= 5 else ('Partial' if n >= 3 else 'Thin')
        dev_pct = round(abs(vw - sa) / sa * 100, 2) if sa and sa > 0 and vw else None
        ldf_diagnostics.append({
            'fromAge': row['fromAge'],
            'toAge': row['toAge'],
            'volumeWeighted': round(vw, 4) if vw else None,
            'straightAvg': round(sa, 4) if sa else None,
            'cov_pct': round(cov * 100, 2),
            'n': n,
            'stability': stability,
            'credibility': credibility,
            'vw_vs_sa_deviation_pct': dev_pct
        })

    # ── 4. AY-level Development Snapshot ─────────────────────────────────────
    ay_summary = []
    if ldfs_raw:
        ldfs_list = [r['volumeWeighted'] for r in ldfs_raw[:-1]] + [1.0]
        cdfs = triangle.compute_cdfs(ldfs_list)
        for i, ay in enumerate(ays):
            paid_val = diag[i]
            dev_idx = next((j for j, v in reversed(list(enumerate(triangle.matrix[i]))) if v is not None), 0)
            cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
            pct_rep = round(1.0 / cdf * 100, 1) if cdf > 0 else 100.0
            ultimate = round(paid_val * cdf, 0) if paid_val else None
            ibnr     = round(ultimate - paid_val, 0) if ultimate and paid_val else None
            ay_summary.append({
                'ay': ay,
                'paid': round(paid_val, 0) if paid_val else None,
                'cdf_to_ult': round(cdf, 4),
                'pct_reported': pct_rep,
                'estimated_ultimate': ultimate,
                'estimated_ibnr': ibnr
            })

    # ── 5. Volume Trend (diagonal progression) ────────────────────────────────
    volume_trends = []
    for i in range(1, len(diag)):
        prev = diag[i - 1]
        curr = diag[i]
        if prev and curr and prev > 0:
            change_pct = round((curr - prev) / prev * 100, 1)
            volume_trends.append({
                'from_ay': ays[i - 1],
                'to_ay': ays[i],
                'change_pct': change_pct,
                'direction': 'up' if change_pct > 5 else ('down' if change_pct < -5 else 'stable')
            })

    # ── 6. Ratio Triangles ────────────────────────────────────────────────────
    ratio_triangles = {
        'paid_to_incurred': [],
        'settlement_rate': []
    }
    
    for i in range(len(triangle.matrix)):
        p2i_row = []
        sr_row = []
        for j in range(len(triangle.matrix[i])):
            # Paid to Incurred
            paid = triangle.matrix[i][j]
            inc = triangle.incurred_matrix[i][j] if hasattr(triangle, 'incurred_matrix') and len(triangle.incurred_matrix) > i and len(triangle.incurred_matrix[i]) > j else None
            if paid is not None and inc is not None and inc != 0:
                p2i_row.append(round(paid / inc, 4))
            else:
                p2i_row.append(None)
                
            # Settlement Rate (Closed / Reported)
            closed = triangle.closed_counts_matrix[i][j] if hasattr(triangle, 'closed_counts_matrix') and len(triangle.closed_counts_matrix) > i and len(triangle.closed_counts_matrix[i]) > j else None
            reported = triangle.reported_counts_matrix[i][j] if hasattr(triangle, 'reported_counts_matrix') and len(triangle.reported_counts_matrix) > i and len(triangle.reported_counts_matrix[i]) > j else None
            if closed is not None and reported is not None and reported != 0:
                sr_row.append(round(closed / reported, 4))
            else:
                sr_row.append(None)
                
        ratio_triangles['paid_to_incurred'].append(p2i_row)
        ratio_triangles['settlement_rate'].append(sr_row)

    # ── 7. Weibull Fit (Full Matrix SSE Optimization) ─────────────────────────
    weibull_fit = None
    if ldfs_raw:
        try:
            from scipy.optimize import minimize
            
            def weibull_cdf_local(t, theta, omega):
                # t can be array
                t_safe = np.maximum(np.array(t, dtype=float), 1e-5)
                return 1 - np.exp(-((t_safe/theta)**omega))
            
            ldfs_list = [r['volumeWeighted'] for r in ldfs_raw[:-1]] + [1.0]
            cdfs = triangle.compute_cdfs(ldfs_list)
            
            # Compute Percentage Developed Triangle & Raw Scatter Points
            raw_points = []
            percent_matrix = []
            dev_ages_np = np.array(triangle.dev_ages, dtype=float)
            
            for i, ay in enumerate(ays):
                row_pct = []
                paid_latest = diag[i]
                dev_idx = next((j for j, v in reversed(list(enumerate(triangle.matrix[i]))) if v is not None), 0)
                cdf = cdfs[dev_idx] if dev_idx < len(cdfs) else 1.0
                ultimate = paid_latest * cdf if paid_latest else None
                
                for j, age in enumerate(triangle.dev_ages):
                    val = triangle.matrix[i][j] if j < len(triangle.matrix[i]) else None
                    if val is not None and ultimate and ultimate > 0:
                        pct = val / ultimate
                        row_pct.append(pct)
                        raw_points.append({'age': int(age), 'ay': str(ay), 'pct_reported': round(pct, 4)})
                    else:
                        row_pct.append(np.nan)
                percent_matrix.append(row_pct)
            
            def objective(params):
                theta, omega = params
                sse = 0
                for row in percent_matrix:
                    actual = np.array(row, dtype=float)
                    mask = ~np.isnan(actual)
                    if np.any(mask):
                        fitted = weibull_cdf_local(dev_ages_np[mask], theta, omega)
                        sse += np.sum((actual[mask] - fitted)**2)
                return sse
                
            initial_guess = [max(dev_ages_np)/2 if len(dev_ages_np) > 0 else 20.0, 1.0]
            res = minimize(
                objective,
                initial_guess,
                method="L-BFGS-B",
                bounds=[(0.001, None), (0.001, None)]
            )
            
            theta = res.x[0]
            omega = res.x[1]
            sse = res.fun
            
            # Generate fitted curve for plotting
            fitted_curve = []
            for age in triangle.dev_ages:
                fitted_val = float(weibull_cdf_local(age, theta, omega))
                fitted_curve.append({'age': int(age), 'fitted_pct': round(fitted_val, 4)})
                
            weibull_fit = {
                'theta': round(float(theta), 4),
                'omega': round(float(omega), 4),
                'sse': round(float(sse), 6),
                'raw_points': raw_points,
                'fitted_curve': fitted_curve
            }
        except Exception as e:
            weibull_fit = {'error': str(e)}

    # ── 7. Curve Fitting ──────────────────────────────────────────────────────
    dev_ages_fit, pct_reported_fit = curve_fit.compute_pct_reported_for_fitting(triangle)
    curve_fitting_results = curve_fit.fit_development_curve(dev_ages_fit, pct_reported_fit)

    # ── 8. Overall ────────────────────────────────────────────────────────────
    avg_trend = round(float(np.mean([t['change_pct'] for t in volume_trends])), 1) if volume_trends else 0.0
    overall = {
        'total_paid': round(total_paid, 0),
        'total_premium': round(total_premium, 0) if total_premium else None,
        'overall_paid_lr_pct': round(total_paid / total_premium * 100, 2) if total_premium else None,
        'suggested_elr_for_bf_bk': suggested_elr,
        'n_accident_years': len(ays),
        'n_dev_periods': len(triangle.dev_ages),
        'has_premium': bool(triangle.premiums),
        'has_counts': any(v is not None for v in triangle.counts.values()),
        'is_long_tail': len(triangle.dev_ages) > 7,
        'avg_paid_volume_trend_pct': avg_trend
    }

    return {
        'overall': overall,
        'loss_ratios_by_ay': loss_ratios,
        'suggested_elr': suggested_elr,
        'ldf_diagnostics': ldf_diagnostics,
        'ay_summary': ay_summary,
        'volume_trends': volume_trends,
        'ratio_triangles': ratio_triangles,
        'curve_fitting': curve_fitting_results,
        'weibull_fit': weibull_fit
    }
