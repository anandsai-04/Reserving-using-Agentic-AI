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
        diag = self.triangle.get_latest_diagonal()
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.triangle.matrix]
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
                'ibnr': ibnr
            })
