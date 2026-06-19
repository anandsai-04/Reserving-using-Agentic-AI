import numpy as np
from .base import MethodBase

class Benktander(MethodBase):
    code = 'BK'
    label = 'Benktander'
    needs_premium = True
    
    @classmethod
    def get_required_params(cls):
        return [{
            'key': 'aprioriLossRatio',
            'label': 'A Priori Loss Ratio (%)',
            'type': 'percent',
            'default': 65,
            'hint': 'Expected loss ratio (e.g., 65 for 65%)'
        }, {
            'key': 'iterations',
            'label': 'Iterations (c)',
            'type': 'number',
            'default': 1,
            'hint': 'c=1 is standard Benktander. Higher values converge to Chain Ladder.'
        }]
        
    def _compute(self):
        ays = self.triangle.accident_years
        diag = self.triangle.get_latest_diagonal()
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.triangle.matrix]
        
        elr = float(self.params.get('aprioriLossRatio', 65)) / 100.0
        iters = int(self.params.get('iterations', 1))
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            prem = self.triangle.premiums.get(ay, 0)
            
            pct_rep = 1.0 / cdf if cdf > 0 else 1.0
            q = pct_unreported = 1.0 - pct_rep
            
            # Initial BF
            U_bf = paid + (prem * elr * q)
            U_current = U_bf
            
            for _ in range(iters):
                U_current = paid + (U_current * q)
                
            ibnr = U_current - paid
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'pctReported': round(pct_rep * 100, 1),
                'ultimate': U_current,
                'ibnr': ibnr
            })
