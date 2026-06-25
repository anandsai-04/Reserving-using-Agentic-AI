import numpy as np
from .base import MethodBase

class CapeCod(MethodBase):
    code = 'CC'
    label = 'Cape Cod (Stanard-Bühlmann)'
    needs_premium = True
    
    @classmethod
    def get_required_params(cls):
        return [{
            'key': 'decay',
            'label': 'Decay Factor',
            'type': 'percent',
            'default': 1.0,
            'hint': '1.0 = standard Cape Cod. <1.0 gives more weight to recent years.'
        }]
        
    def _compute(self):
        ays = self.triangle.accident_years
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        decay = float(self.params.get('decay', 0.9))
        trend_rate = float(self.params.get('trend_rate', 0.0)) / 100.0
        use_latest_premium = bool(self.params.get('use_latest_premium', True))
        
        latest_ay = ays[-1] if ays else 2000
        latest_prem = self.triangle.premiums.get(latest_ay, 0)
        
        # Calculate overall ELR
        used_prem = 0
        used_ult_cl = 0
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            
            # Determine premium basis
            if use_latest_premium and latest_prem > 0:
                # Trend latest premium back to historical year
                prem = latest_prem * ((1.0 + trend_rate) ** (ay - latest_ay))
            else:
                prem = self.triangle.premiums.get(ay, 0)
                
            pct_rep = 1.0 / cdf if cdf > 0 else 1.0
            weight = decay ** (len(ays) - 1 - i)
            
            # Trend losses and premium to current/latest year for ELR calculation
            trend_factor = (1.0 + trend_rate) ** (latest_ay - ay)
            trended_paid = paid * trend_factor
            trended_prem = prem * trend_factor
            
            used_prem += trended_prem * pct_rep * weight
            used_ult_cl += trended_paid * weight
            
        overall_elr = used_ult_cl / used_prem if used_prem > 0 else 0.65
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            
            if use_latest_premium and latest_prem > 0:
                prem = latest_prem * ((1.0 + trend_rate) ** (ay - latest_ay))
            else:
                prem = self.triangle.premiums.get(ay, 0)
                
            pct_unreported = 1.0 - (1.0 / cdf) if cdf > 0 else 0
            # Trend overall ELR back to the historical year level to calculate IBNR
            historical_elr = overall_elr * ((1.0 + trend_rate) ** (ay - latest_ay))
            ibnr = prem * historical_elr * pct_unreported
            ultimate = paid + ibnr
            pct_rep = (1.0 / cdf * 100) if cdf > 0 else 100
            
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'pctReported': round(pct_rep, 1),
                'ultimate': ultimate,
                'ibnr': ibnr,
                'capeCodELR': round(overall_elr, 4),
                'premium': prem
            })
