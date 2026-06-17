import pandas as pd
import numpy as np
from io import StringIO
import math

class Triangle:
    def __init__(self):
        self.accident_years = []
        self.dev_ages = []
        self.matrix = []
        self.incurred_matrix = []
        self.data_type = 'paid'
        self.premiums = {}
        self.exposures = {}
        self.counts = {}
        self._format = None
        self._raw_data = {}
        self.parse_log = []

    @classmethod
    def from_csv(cls, csv_text: str):
        t = cls()
        df = pd.read_csv(StringIO(csv_text))
        
        # Lowercase headers and strip whitespace
        df.columns = [str(c).strip().lower() for c in df.columns]
        header = list(df.columns)
        
        t.parse_log.append(f"Columns found: {header}")
        
        t._format = t._detect_format(header)
        t.parse_log.append(f"Detected format: {t._format}")
        
        if t._format == 'long':
            t._parse_long(df)
        else:
            t._parse_wide(df)
            
        t._build_matrix()
        
        if not t.accident_years:
            raise ValueError("Could not extract accident years from this CSV.")
            
        return t
        
    def _detect_format(self, header):
        has_dev = any(any(c in h for c in ['dev', 'age', 'lag', 'period']) for h in header)
        has_ay = any(any(c in h for c in ['accident', 'ay', 'origin', 'year']) and 'development' not in h for h in header)
        has_loss = any(any(c in h for c in ['paid', 'loss', 'incurred', 'reported']) for h in header)
        
        if has_dev and has_ay and has_loss:
            return 'long'
            
        return 'wide'
        
    def _best_col(self, df, candidates):
        header = list(df.columns)
        # Exact match
        for c in candidates:
            if c in header: return c
        # Substring match
        for c in candidates:
            for h in header:
                if c in h: return h
        return None

    def _parse_long(self, df):
        ay_col = self._best_col(df, ['accidentyear', 'accident_year', 'ay', 'origin', 'year'])
        dev_col = self._best_col(df, ['developmentlag', 'devlag', 'dev_age', 'dev', 'lag', 'age', 'period'])
        paid_col = self._best_col(df, ['cumpaidloss', 'paid', 'loss'])
        inc_col = self._best_col(df, ['incurloss', 'incurred', 'reported'])
        cnt_col = self._best_col(df, ['count', 'claims', 'freq'])
        prem_col = self._best_col(df, ['earnedpremnet', 'earnedprem', 'premium', 'ep'])
        exp_col = self._best_col(df, ['exposure', 'units'])
        
        if not ay_col or not dev_col:
            raise ValueError(f"Long format detected but could not find accident_year/dev_age columns.")

        ay_set = set()
        dev_set = set()
        
        for _, row in df.iterrows():
            ay = int(row[ay_col]) if pd.notna(row[ay_col]) else None
            dev = int(row[dev_col]) if pd.notna(row[dev_col]) else None
            if ay is None or dev is None or ay < 1900 or ay > 2100: continue
            
            ay_set.add(ay)
            dev_set.add(dev)
            
            key = f"{ay}|{dev}"
            if key not in self._raw_data:
                self._raw_data[key] = {'paid': 0, 'incurred': 0, 'count': 0}
                
            paid_val = float(row[paid_col]) if paid_col and pd.notna(row[paid_col]) else 0
            inc_val = float(row[inc_col]) if inc_col and pd.notna(row[inc_col]) else 0
            cnt_val = float(row[cnt_col]) if cnt_col and pd.notna(row[cnt_col]) else 0
            
            # Since some values might be missing initially, we replace None with 0 above but we must handle if we want them to stay None if completely missing.
            # To keep it simple, if we ever see a valid number, we add it.
            if pd.notna(paid_val): self._raw_data[key]['paid'] = (self._raw_data[key].get('paid') or 0) + paid_val
            if pd.notna(inc_val): self._raw_data[key]['incurred'] = (self._raw_data[key].get('incurred') or 0) + inc_val
            if pd.notna(cnt_val): self._raw_data[key]['count'] = (self._raw_data[key].get('count') or 0) + cnt_val
            
            # For premium and exposure, they are usually per Accident Year, but if long format repeats them, we shouldn't sum them across all Dev Ages blindly.
            # Usually, in CAS data, premium is repeated on every row for that AY.
            # So we should just take the max or the first one we see, rather than sum.
            if prem_col and pd.notna(row[prem_col]):
                self.premiums[ay] = max(self.premiums.get(ay, 0), float(row[prem_col]))
            if exp_col and pd.notna(row[exp_col]):
                self.exposures[ay] = max(self.exposures.get(ay, 0), float(row[exp_col]))
                
        self.accident_years = sorted(list(ay_set))
        dev_ages = sorted(list(dev_set))
        
        # Normalize dev ages to months if they are just periods (1, 2, 3...)
        if dev_ages and max(dev_ages) <= 20:
            dev_ages = [d * 12 for d in dev_ages]
            remapped = {}
            for k, v in self._raw_data.items():
                ay, dev = k.split('|')
                remapped[f"{ay}|{int(dev)*12}"] = v
            self._raw_data = remapped
            
        self.dev_ages = dev_ages
        self.data_type = 'paid' if paid_col else ('incurred' if inc_col else 'paid')
        
    def _parse_wide(self, df):
        header = list(df.columns)
        ay_col = self._best_col(df, ['accident_year', 'ay', 'origin', 'year', 'loss_year'])
        if not ay_col: ay_col = header[0]
        
        dev_cols = [c for c in header if c != ay_col and any(char.isdigit() for char in str(c))]
        if not dev_cols:
            dev_cols = [c for c in header if c != ay_col]
            
        dev_ages = []
        for i, c in enumerate(dev_cols):
            num_str = ''.join(filter(str.isdigit, str(c)))
            dev_ages.append(int(num_str) if num_str else (i+1)*12)
            
        if max(dev_ages) <= 20:
            dev_ages = [d * 12 for d in dev_ages]
            
        self.dev_ages = sorted(list(set(dev_ages)))
        
        prem_col = self._best_col(df, ['premium', 'ep', 'earned_premium'])
        exp_col = self._best_col(df, ['exposure', 'exposures', 'units'])
        
        ay_set = set()
        for _, row in df.iterrows():
            ay = int(row[ay_col]) if pd.notna(row[ay_col]) else None
            if ay is None or ay < 1900 or ay > 2100: continue
            ay_set.add(ay)
            
            for j, c in enumerate(dev_cols):
                val = float(row[c]) if pd.notna(row[c]) else None
                self._raw_data[f"{ay}|{self.dev_ages[j]}"] = {'paid': val, 'incurred': None, 'count': None}
                
            if prem_col and pd.notna(row[prem_col]):
                self.premiums[ay] = float(row[prem_col])
            if exp_col and pd.notna(row[exp_col]):
                self.exposures[ay] = float(row[exp_col])
                
        self.accident_years = sorted(list(ay_set))
        self.data_type = 'paid'

    def _build_matrix(self):
        for ay in self.accident_years:
            row = []
            inc_row = []
            for dev in self.dev_ages:
                cell = self._raw_data.get(f"{ay}|{dev}")
                row.append(cell['paid'] if cell and cell['paid'] is not None else None)
                inc_row.append(cell['incurred'] if cell and cell['incurred'] is not None else None)
            self.matrix.append(row)
            self.incurred_matrix.append(inc_row)
            
            for dev in reversed(self.dev_ages):
                cell = self._raw_data.get(f"{ay}|{dev}")
                if cell and cell['count'] is not None:
                    self.counts[ay] = cell['count']
                    break

    def get_latest_diagonal(self):
        diag = []
        for row in self.matrix:
            val = None
            for v in reversed(row):
                if v is not None and not np.isnan(v):
                    val = v
                    break
            diag.append(val)
        return diag
        
    def compute_ldfs(self):
        n = len(self.dev_ages)
        ldfs = []
        
        for j in range(n - 1):
            sum_num = 0
            sum_den = 0
            factors = []
            col_factors = []
            
            for row in self.matrix:
                cur = row[j]
                nxt = row[j+1]
                if cur is not None and nxt is not None and not np.isnan(cur) and not np.isnan(nxt) and cur > 0:
                    sum_num += nxt
                    sum_den += cur
                    f = nxt / cur
                    factors.append(f)
                    col_factors.append({'from': cur, 'to': nxt, 'f': f})
                    
            vw = sum_num / sum_den if sum_den > 0 else None
            n_pts = len(factors)
            sa = sum(factors) / n_pts if n_pts > 0 else None
            
            # Weighted averages
            last3 = col_factors[-3:] if len(col_factors) >= 3 else col_factors
            last5 = col_factors[-5:] if len(col_factors) >= 5 else col_factors
            wa3 = sum(x['to'] for x in last3) / sum(x['from'] for x in last3) if sum(x['from'] for x in last3) > 0 else None
            wa5 = sum(x['to'] for x in last5) / sum(x['from'] for x in last5) if sum(x['from'] for x in last5) > 0 else None
            
            std = np.std(factors, ddof=1) if n_pts > 1 else 0
            mean = sa if sa else 0
            cov = (std / mean) if mean > 0 else 0
            
            ldfs.append({
                'fromAge': self.dev_ages[j],
                'toAge': self.dev_ages[j+1],
                'volumeWeighted': vw,
                'straightAvg': sa,
                'weighted3yr': wa3,
                'weighted5yr': wa5,
                'std': std if not np.isnan(std) else 0,
                'cov': cov if not np.isnan(cov) else 0,
                'n': n_pts,
                'isTail': False
            })
            
        ldfs.append({
            'fromAge': self.dev_ages[-1],
            'toAge': 'Ultimate',
            'volumeWeighted': 1.0,
            'straightAvg': 1.0,
            'weighted3yr': 1.0,
            'weighted5yr': 1.0,
            'std': 0, 'cov': 0, 'n': 0,
            'isTail': True
        })
        return ldfs

    def compute_cdfs(self, ldfs_list):
        n = len(ldfs_list)
        cdfs = [1.0] * n
        cdfs[n-1] = ldfs_list[-1]
        for j in range(n-2, -1, -1):
            cdfs[j] = ldfs_list[j] * cdfs[j+1]
        return cdfs

    def get_summary(self):
        n = len(self.accident_years)
        m = len(self.dev_ages)
        diag = self.get_latest_diagonal()
        total_paid = sum(v for v in diag if v is not None)
        
        filled = sum(1 for row in self.matrix for v in row if v is not None)
        upper_tri = min(n*(n+1)//2, n*m)
        completeness = (filled / upper_tri * 100) if upper_tri > 0 else 0
        
        return {
            'accidentYears': n,
            'devPeriods': m,
            'oldestAY': self.accident_years[0] if n > 0 else None,
            'latestAY': self.accident_years[-1] if n > 0 else None,
            'maxDevAge': max(self.dev_ages) if m > 0 else 0,
            'totalPaid': total_paid,
            'completeness': round(completeness, 1),
            'isNewLOB': n <= 3,
            'isLongTail': m > 7,
            'hasPremium': len(self.premiums) > 0,
            'hasExposure': len(self.exposures) > 0,
            'hasCounts': any(v is not None for v in self.counts.values()),
            'format': self._format,
            'dataType': self.data_type,
            'parseLog': self.parse_log
        }
