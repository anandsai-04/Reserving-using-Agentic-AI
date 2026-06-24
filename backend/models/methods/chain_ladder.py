import numpy as np
from .base import MethodBase

class ChainLadder(MethodBase):
    code = 'CL'
    label = 'Chain Ladder (Basic)'
    needs_premium = False
    
    def _compute(self):
        ays = self.triangle.accident_years
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            
            ultimate = paid * cdf
            ibnr = ultimate - paid
            pct_rep = (1.0 / cdf * 100) if cdf > 0 else 100
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'pctReported': round(pct_rep, 1),
                'ultimate': ultimate,
                'ibnr': ibnr
            })
