import numpy as np
from .base import MethodBase

class CaseOutstanding(MethodBase):
    code = 'CO'
    label = 'Case Outstanding'
    needs_premium = False
    requires_paid_triangle = True
    requires_incurred_triangle = True
    supports_source_selection = False
    
    def _compute(self):
        ays = self.triangle.accident_years
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in (self.triangle.matrix if self.triangle.matrix else [])]
        
        inc_diag = []
        for row in (self.triangle.incurred_matrix if self.triangle.incurred_matrix else []):
            val = None
            for v in reversed(row):
                if v is not None and not np.isnan(v):
                    val = v
                    break
            inc_diag.append(val)
            
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            incurred = inc_diag[i] if i < len(inc_diag) and inc_diag[i] is not None else paid
            case_os = max(0, incurred - paid)
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': 1.0,
                'pctReported': 100.0,
                'ultimate': paid + case_os,
                'ibnr': case_os,
                'note': 'Case OS only'
            })
