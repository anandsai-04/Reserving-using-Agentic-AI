import numpy as np
from .base import MethodBase

class ExpectedLossRatio(MethodBase):
    code = 'ELR'
    label = 'Expected Loss Ratio'
    needs_premium = True
    
    @classmethod
    def get_required_params(cls):
        return [
            {
                'key': 'nMatureYears',
                'label': 'Mature Years (n)',
                'type': 'number',
                'default': 5,
                'hint': 'Number of oldest years to consider mature for ELR calculation.'
            },
            {
                'key': 'lrCap',
                'label': 'Loss Ratio Cap',
                'type': 'number',
                'default': 5.0,
                'hint': 'Maximum allowed historical loss ratio (guardrail).'
            }
        ]
        
    def _compute(self):
        ays = self.triangle.accident_years
        diag = [next((v for v in reversed(row) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        dev_idx = [next((i for i, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in self.matrix]
        
        mature_years = self.params.get('matureYears')
        if mature_years:
            is_mature = lambda i, ay: ay in mature_years
        else:
            n_mature = int(self.params.get('nMatureYears', 5))
            is_mature = lambda i, ay: i < n_mature
            
        lr_cap = float(self.params.get('lrCap', 5.0))
        
        # 1. Calculate historical LR for mature years
        mature_ultimates = []
        mature_premiums = []
        historical_lrs = []
        
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            prem = self.triangle.premiums.get(ay, 0)
            ult = paid * cdf
            
            # Is mature year
            if is_mature(i, ay):
                if prem > 0 and ult > 0:
                    lr = ult / prem
                    # Apply guardrail
                    if 0 < lr < lr_cap:
                        mature_ultimates.append(ult)
                        mature_premiums.append(prem)
                        historical_lrs.append(lr)
        
        # 2. Calculate Premium-Weighted ELR
        total_mature_ult = sum(mature_ultimates)
        total_mature_prem = sum(mature_premiums)
        
        if total_mature_prem > 0:
            weighted_elr = total_mature_ult / total_mature_prem
        else:
            weighted_elr = 0.65  # Fallback
            
        # 3. Detect Outliers in Mature Years using IQR
        outliers = []
        if len(historical_lrs) > 0:
            q1 = np.percentile(historical_lrs, 25)
            q3 = np.percentile(historical_lrs, 75)
            iqr = q3 - q1
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr
            
            for i, ay in enumerate(ays):
                if is_mature(i, ay):
                    prem = self.triangle.premiums.get(ay, 0)
                    ult = (diag[i] or 0) * (self.cdfs[dev_idx[i]] if dev_idx[i] < len(self.cdfs) else 1.0)
                    if prem > 0:
                        lr = ult / prem
                        if lr < lower_bound or lr > upper_bound:
                            outliers.append(str(ay))
        
        # 4. Project and Calculate IBNR for all years
        for i, ay in enumerate(ays):
            paid = diag[i] or 0
            prem = self.triangle.premiums.get(ay, 0)
            idx = dev_idx[i]
            cdf = self.cdfs[idx] if idx < len(self.cdfs) else 1.0
            
            if is_mature(i, ay):
                # Mature: standard chain ladder development
                ultimate = paid * cdf
                ibnr = ultimate - paid
            else:
                # Immature: ELR method
                ultimate = prem * weighted_elr
                ibnr = ultimate - paid if ultimate > paid else 0
                
            self.results.append({
                'ay': ay,
                'paid': paid,
                'cdfToUlt': round(cdf, 4),
                'ultimate': ultimate,
                'ibnr': ibnr,
                'outlier': str(ay) in outliers
            })
