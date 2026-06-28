import numpy as np
from scipy.optimize import curve_fit
import warnings

def weibull_cdf(x, shape, scale):
    x = np.maximum(x, 1e-5)  # prevent log(0) issues
    return 1 - np.exp(- (x / scale)**shape)

def loglogistic_cdf(x, shape, scale):
    x = np.maximum(x, 1e-5)
    return 1 / (1 + (x / scale)**-shape)

def pareto_cdf(x, shape, scale):
    # Shifted Pareto (Lomax) so it starts at 0
    x = np.maximum(x, 0)
    return 1 - (scale / (x + scale))**shape

def fit_development_curve(dev_ages, pct_reported):
    """
    Fits three distinct statistical curves to the % reported data.
    Returns the optimal parameters and the R-squared for each.
    """
    if len(dev_ages) < 3 or len(pct_reported) < 3:
        return {"error": "Not enough data points to fit curves."}
        
    x_data = np.array(dev_ages)
    y_data = np.array(pct_reported)
    
    # Ensure y_data is strictly between 0 and 1 for CDF fitting
    y_data = np.clip(y_data, 1e-5, 0.99999)
    
    results = {}
    
    def calculate_r2(y_true, y_pred):
        ss_res = np.sum((y_true - y_pred)**2)
        ss_tot = np.sum((y_true - np.mean(y_true))**2)
        return 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
        
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        
        # 1. Weibull
        try:
            # Initial guess: shape=1, scale=max(dev_ages)/2
            popt_w, _ = curve_fit(weibull_cdf, x_data, y_data, p0=[1.0, max(x_data)/2], bounds=([0.1, 0.1], [10, 1000]))
            y_pred_w = weibull_cdf(x_data, *popt_w)
            r2_w = calculate_r2(y_data, y_pred_w)
            results['weibull'] = {
                'shape': round(popt_w[0], 4),
                'scale': round(popt_w[1], 4),
                'r_squared': round(r2_w, 4)
            }
        except:
            pass

        # 2. Loglogistic
        try:
            popt_l, _ = curve_fit(loglogistic_cdf, x_data, y_data, p0=[1.0, max(x_data)/2], bounds=([0.1, 0.1], [10, 1000]))
            y_pred_l = loglogistic_cdf(x_data, *popt_l)
            r2_l = calculate_r2(y_data, y_pred_l)
            results['loglogistic'] = {
                'shape': round(popt_l[0], 4),
                'scale': round(popt_l[1], 4),
                'r_squared': round(r2_l, 4)
            }
        except:
            pass
            
        # 3. Pareto (Lomax)
        try:
            popt_p, _ = curve_fit(pareto_cdf, x_data, y_data, p0=[1.0, max(x_data)/2], bounds=([0.1, 0.1], [10, 1000]))
            y_pred_p = pareto_cdf(x_data, *popt_p)
            r2_p = calculate_r2(y_data, y_pred_p)
            results['pareto'] = {
                'shape': round(popt_p[0], 4),
                'scale': round(popt_p[1], 4),
                'r_squared': round(r2_p, 4)
            }
        except:
            pass
            
    return results

def compute_pct_reported_for_fitting(triangle):
    """
    Extracts the average empirical % reported (or % paid) at each development age
    to be used for curve fitting.
    """
    ldfs_raw = triangle.compute_ldfs()
    if not ldfs_raw:
        return [], []
        
    # Standard LDFs
    ldfs_list = [r['volumeWeighted'] for r in ldfs_raw[:-1]] + [1.0]
    cdfs = triangle.compute_cdfs(ldfs_list)
    
    # CDFs to % reported
    pct_reported = [1.0 / cdf if cdf > 0 else 1.0 for cdf in cdfs]
    
    dev_ages = triangle.dev_ages[:len(pct_reported)]
    
    return dev_ages, pct_reported
