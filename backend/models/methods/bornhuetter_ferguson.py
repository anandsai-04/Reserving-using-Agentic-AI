import numpy as np
from .base import MethodBase

class BornhuetterFerguson(MethodBase):
    code = 'BF'
    label = 'Bornhuetter-Ferguson'
    needs_premium = True
    
    @classmethod
    def get_required_params(cls):
        return [{
            'key': 'aprioriLossRatio',
            'label': 'A Priori Loss Ratio (%)',
            'type': 'percent',
            'default': 65,
            'hint': 'Expected loss ratio (e.g., 65 for 65%)'
        }]
        
    def _compute(self):
        ays = self.triangle.accident_years
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        elr = float(self.params.get('aprioriLossRatio', 65)) / 100.0
        
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            prem = self.triangle.premiums.get(ay, 0)
            
            pct_unreported = 1.0 - (1.0 / cdf) if cdf > 0 else 0
            pct_rep = (1.0 / cdf * 100) if cdf > 0 else 100
            
            ibnr = prem * elr * pct_unreported
            ultimate = paid + ibnr
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'pctReported': round(pct_rep, 1),
                'ultimate': ultimate,
                'ibnr': ibnr,
                'premium': prem
            })
            
        # Add IQR Outlier Detection on Ultimate Loss Ratios
        lrs = [r['ultimate'] / r['premium'] for r in self.results if r.get('premium', 0) > 0]
        if lrs:
            q1 = np.percentile(lrs, 25)
            q3 = np.percentile(lrs, 75)
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            
            for r in self.results:
                if r.get('premium', 0) > 0:
                    lr = r['ultimate'] / r['premium']
                    r['outlier'] = bool(lr < lower or lr > upper)
                else:
                    r['outlier'] = False
                    
        # Add Portfolio Volatility Metric (Std Dev of IBNR)
        ibnrs = [r['ibnr'] for r in self.results]
        self.volatility = float(np.std(ibnrs)) if len(ibnrs) > 1 else 0.0
