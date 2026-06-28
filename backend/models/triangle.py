import pandas as pd
import numpy as np
from collections import defaultdict
from io import StringIO
import math

def build_triangle(df, index_col, column_col, value_col, aggfunc="sum"):
    """
    Builds a triangle from a long-form DataFrame.
    Returns the pure 2D pivot table.
    """
    return df.pivot_table(
        index=index_col,
        columns=column_col,
        values=value_col,
        aggfunc=aggfunc
    )

class Triangle:
    def __init__(self, valuation_year=None, roles=None):
        self.valuation_year = valuation_year
        self.roles = roles or {}
        self._raw_data = defaultdict(lambda: {'paid': None, 'incurred': None, 'count': None})
        self.accident_years = []
        self.dev_ages = []
        self.matrix = []
        self.incurred_matrix = []
        self.outstanding_matrix = []
        self.closed_counts_matrix = []
        self.reported_counts_matrix = []
        self.data_type = 'paid'
        self.premiums = {}
        self.exposures = {}
        self.counts = {}
        self._format = None
        self.parse_log = []

    @classmethod
    def from_csv(cls, csv_text: str, valuation_year=None):
        t = cls(valuation_year=valuation_year)
        
        # First pass to check if there is a header
        first_line = csv_text.strip().split('\n')[0]
        # If the first line is mostly numbers (e.g. "2000, 100, 150, 200"), there is no header!
        tokens = first_line.split(',')
        numeric_count = 0
        for token in tokens:
            try:
                float(token.strip().replace('$', ''))
                numeric_count += 1
            except:
                pass
                
        has_header = True
        if len(tokens) > 0 and numeric_count / len(tokens) > 0.5:
            has_header = False
            
        if has_header:
            df = pd.read_csv(StringIO(csv_text))
            df.columns = [str(c).strip().lower() for c in df.columns]
        else:
            df = pd.read_csv(StringIO(csv_text), header=None)
            
        header = [str(c).strip().lower() for c in df.columns]
        
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
        has_dev = any(any(c in h for c in ['dev', 'age', 'lag', 'period', 'transaction', 'date']) for h in header)
        has_ay = any(any(c in h for c in ['accident', 'ay', 'origin', 'year', 'reporting', 'date']) and 'development' not in h for h in header)
        has_loss = any(any(c in h for c in ['paid', 'loss', 'incurred', 'reported', 'amount']) for h in header)
        
        if has_dev and has_ay and has_loss:
            return 'long'
            
        return 'wide'
        
    def _best_col(self, df, candidates):
        header = list(df.columns)
        for c in candidates:
            if c in header: return c
        for c in candidates:
            for h in header:
                if c in str(h).lower(): return h
        return None

    def _parse_long(self, df):
        def get_col(role_key, candidates):
            col = self.roles.get(role_key)
            if col and str(col).strip().lower() in df.columns:
                return str(col).strip().lower()
            return self._best_col(df, candidates)

        ay_col = get_col('origin_col', ['accidentyear', 'accident_year', 'ay', 'origin', 'year'])
        dev_col = get_col('dev_col', ['developmentlag', 'devlag', 'dev_age', 'dev', 'lag', 'age', 'period'])
        
        # Transactional Fallbacks
        trans_date_col = get_col('transaction_date_col', ['transactiondate', 'transdate', 't_date', 'transaction'])
        rep_date_col = get_col('reporting_date_col', ['reportingdate', 'reportdate', 'reporting', 'report'])
        trans_type_col = get_col('transaction_type_col', ['transactiontype', 'transtype', 'type'])
        trans_amt_col = get_col('transaction_amount_col', ['transactionamount', 'transamount', 'amount'])
        
        # Determine AY and Dev if missing but dates present
        if not ay_col and rep_date_col:
            df['__temp_ay'] = pd.to_datetime(df[rep_date_col], errors='coerce').dt.year
            ay_col = '__temp_ay'
        if not dev_col and trans_date_col and ay_col:
            df['__temp_trans_year'] = pd.to_datetime(df[trans_date_col], errors='coerce').dt.year
            df['__temp_dev'] = (df['__temp_trans_year'] - df[ay_col] + 1) * 12
            dev_col = '__temp_dev'

        paid_col = get_col('paid_col', ['cumpaidloss', 'paid', 'loss'])
        inc_col = get_col('incurred_col', ['incurloss', 'incurred'])
        os_col = get_col('outstanding_col', ['caseoutstanding', 'outstanding', 'os', 'reserve'])
        
        # Transactional Ledger Parsing
        if trans_type_col and trans_amt_col:
            df['__temp_paid'] = df.apply(lambda row: pd.to_numeric(row[trans_amt_col], errors='coerce') if 'paid' in str(row[trans_type_col]).lower() else 0, axis=1)
            df['__temp_os'] = df.apply(lambda row: pd.to_numeric(row[trans_amt_col], errors='coerce') if any(x in str(row[trans_type_col]).lower() for x in ['os', 'reserve', 'outstanding', 'case']) else 0, axis=1)
            paid_col = '__temp_paid'
            os_col = '__temp_os'
            inc_col = None # Will be summed from paid+os automatically later
            
        cnt_col = get_col('count_col', ['count', 'claims', 'freq'])
        closed_cnt_col = get_col('closed_count_col', ['closedcount', 'closed'])
        rep_cnt_col = get_col('reported_count_col', ['reportedcount', 'reported'])

        prem_col = get_col('premium_col', ['earnedpremnet', 'earnedprem', 'premium', 'ep'])
        exp_col = get_col('exposure_col', ['exposure', 'units'])
        
        if not ay_col or not dev_col:
            raise ValueError(f"Long format detected but could not find accident_year/dev_age columns.")

        df[ay_col] = pd.to_numeric(df[ay_col], errors='coerce')
        df[dev_col] = pd.to_numeric(df[dev_col], errors='coerce')
        df = df.dropna(subset=[ay_col, dev_col])
        df[ay_col] = df[ay_col].astype(int)
        df[dev_col] = df[dev_col].astype(int)
        df = df[(df[ay_col] >= 1900) & (df[ay_col] <= 2100)]
        
        if self.valuation_year is not None:
            df = df[df[ay_col] <= self.valuation_year]
        
        self.accident_years = sorted(df[ay_col].unique().tolist())
        dev_ages = sorted(df[dev_col].unique().tolist())
        
        if dev_ages and max(dev_ages) <= 20:
            df[dev_col] = df[dev_col] * 12
            dev_ages = sorted(df[dev_col].unique().tolist())
        self.dev_ages = dev_ages
        
        if self.valuation_year is not None:
            df = df[df[ay_col] + (df[dev_col] / 12) - 1 <= self.valuation_year]
        
        def pivot_and_extract(value_col, agg="sum"):
            if value_col and value_col in df.columns:
                df[value_col] = pd.to_numeric(df[value_col], errors='coerce')
                pt = build_triangle(df, ay_col, dev_col, value_col, aggfunc=agg)
                pt = pt.reindex(index=self.accident_years, columns=self.dev_ages)
                matrix_values = pt.values.tolist()
                return [[None if pd.isna(x) else float(x) for x in row] for row in matrix_values]
            return [[None] * len(self.dev_ages) for _ in self.accident_years]

        self.matrix = pivot_and_extract(paid_col)
        self.incurred_matrix = pivot_and_extract(inc_col)
        self.outstanding_matrix = pivot_and_extract(os_col)
        
        # If incurred exists but outstanding doesn't, calculate outstanding
        if inc_col and paid_col and not os_col:
            for i in range(len(self.matrix)):
                for j in range(len(self.matrix[i])):
                    if self.incurred_matrix[i][j] is not None and self.matrix[i][j] is not None:
                        self.outstanding_matrix[i][j] = self.incurred_matrix[i][j] - self.matrix[i][j]
                        
        # If paid and outstanding exists but incurred doesn't, calculate incurred
        if paid_col and os_col and not inc_col:
            for i in range(len(self.matrix)):
                for j in range(len(self.matrix[i])):
                    if self.outstanding_matrix[i][j] is not None and self.matrix[i][j] is not None:
                        self.incurred_matrix[i][j] = self.outstanding_matrix[i][j] + self.matrix[i][j]

        self.closed_counts_matrix = pivot_and_extract(closed_cnt_col)
        self.reported_counts_matrix = pivot_and_extract(rep_cnt_col)
        
        count_matrix = pivot_and_extract(cnt_col)
        
        for i, ay in enumerate(self.accident_years):
            # Try to grab counts from reported counts, then fallback to generic counts
            rep_row = self.reported_counts_matrix[i]
            for v in reversed(rep_row):
                if v is not None:
                    self.counts[ay] = v
                    break
            if ay not in self.counts:
                for v in reversed(count_matrix[i]):
                    if v is not None:
                        self.counts[ay] = v
                        break

        # Entity column detection for correct premium and exposure aggregation
        ent_col = None
        for c in df.columns:
            if str(c).lower() in ['grcode', 'entity', 'company', 'company_id', 'group']:
                ent_col = c
                break

        if prem_col:
            df[prem_col] = pd.to_numeric(df[prem_col], errors='coerce')
            if ent_col and ent_col in df.columns:
                # Group by entity and accident year to get the first (since it is repeated per lag), then sum across entities
                prem_series = df.groupby([ent_col, ay_col])[prem_col].first().groupby(ay_col).sum()
            else:
                prem_series = df.groupby(ay_col)[prem_col].max()
            self.premiums = prem_series.dropna().to_dict()
            
        if exp_col:
            df[exp_col] = pd.to_numeric(df[exp_col], errors='coerce')
            if ent_col and ent_col in df.columns:
                exp_series = df.groupby([ent_col, ay_col])[exp_col].first().groupby(ay_col).sum()
            else:
                exp_series = df.groupby(ay_col)[exp_col].max()
            self.exposures = exp_series.dropna().to_dict()

        self.data_type = 'paid' if paid_col else ('incurred' if inc_col else 'paid')
        self._raw_data = None
        
    def _parse_wide(self, df):
        header = list(df.columns)
        def get_col(role_key, candidates):
            col = self.roles.get(role_key)
            if col and str(col).strip().lower() in df.columns:
                return str(col).strip().lower()
            return self._best_col(df, candidates)

        ay_col = get_col('origin_col', ['accident_year', 'ay', 'origin', 'year', 'loss_year'])
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
        
        prem_col = get_col('premium_col', ['premium', 'ep', 'earned_premium'])
        exp_col = get_col('exposure_col', ['exposure', 'exposures', 'units'])
        
        ay_set = set()
        for _, row in df.iterrows():
            ay = int(row[ay_col]) if pd.notna(row[ay_col]) else None
            if ay is None or ay < 1900 or ay > 2100: continue
            if self.valuation_year is not None and ay > self.valuation_year: continue
            ay_set.add(ay)
            
            for j, c in enumerate(dev_cols):
                dev_age = self.dev_ages[j]
                if self.valuation_year is not None and (ay + (dev_age / 12) - 1) > self.valuation_year:
                    continue
                val = float(row[c]) if pd.notna(row[c]) else None
                self._raw_data[f"{ay}|{dev_age}"] = {'paid': val, 'incurred': None, 'count': None}
                
            if prem_col and pd.notna(row[prem_col]): self.premiums[ay] = float(row[prem_col])
            if exp_col and pd.notna(row[exp_col]): self.exposures[ay] = float(row[exp_col])
            
        self.accident_years = sorted(list(ay_set))
        self.data_type = 'paid'

    def _build_matrix(self):
        if self._raw_data is None: return
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
        
        return diag
        
    def compute_ldfs_for_matrix(self, matrix):
        n = len(self.dev_ages)
        ldfs = []
        
        for j in range(n - 1):
            sum_num = 0
            sum_den = 0
            factors = []
            col_factors = []
            
            for row in matrix:
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

    def compute_ldfs(self):
        return self.compute_ldfs_for_matrix(self.matrix)

    def compute_incurred_ldfs(self):
        return self.compute_ldfs_for_matrix(self.incurred_matrix)


    def compute_cdfs(self, ldfs_list):
        n = len(ldfs_list)
        cdfs = [1.0] * n
        cdfs[n-1] = ldfs_list[-1] if ldfs_list[-1] is not None else 1.0
        for j in range(n-2, -1, -1):
            val = ldfs_list[j] if ldfs_list[j] is not None else 1.0
            cdfs[j] = val * cdfs[j+1]
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
