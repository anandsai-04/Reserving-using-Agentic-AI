import numpy as np
import math
from .base import MethodBase

class MackChainladder(MethodBase):
    code = 'MCL'
    label = 'Mack Chain Ladder'
    needs_premium = False
    
    def _compute(self):
        ays = self.triangle.accident_years
        matrix = self.matrix
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in matrix]
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in matrix]
        
        # Calculate sigma squared for each period
        sigmas = []
        n_periods = len(self.triangle.dev_ages)
        for j in range(n_periods - 1):
            sum_num = 0
            n_pts = 0
            for row in matrix:
                cur = row[j]
                nxt = row[j+1]
                if cur is not None and nxt is not None and cur > 0:
                    sum_num += cur * (nxt/cur - self.ldfs[j])**2
                    n_pts += 1
            var = sum_num / (n_pts - 1) if n_pts > 1 else 0
            sigmas.append(var)
        sigmas.append(0) # Tail
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            
            ultimate = paid * cdf
            ibnr = ultimate - paid
            pct_rep = (1.0 / cdf * 100) if cdf > 0 else 100
            
            mse_sum = 0
            if ultimate > 0:
                for k in range(idx, n_periods - 1):
                    fk = self.ldfs[k]
                    if fk > 0:
                        mse_sum += (sigmas[k] / (fk**2)) * (1.0 / paid)
                        
            std_err = math.sqrt(ultimate**2 * mse_sum) if mse_sum > 0 else 0
            cv = (std_err / ibnr * 100) if ibnr > 0 else 0
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'pctReported': round(pct_rep, 1),
                'ultimate': ultimate,
                'ibnr': ibnr,
                'stdError': std_err,
                'cv': round(cv, 1),
                'ibnr_75': ibnr + 0.674 * std_err,
                'ibnr_95': ibnr + 1.645 * std_err
            })
