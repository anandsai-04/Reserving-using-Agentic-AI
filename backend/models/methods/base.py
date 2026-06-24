import numpy as np
import math

class MethodBase:
    code = 'BASE'
    label = 'Base Method'
    needs_premium = False
    requires_paid_triangle = False
    requires_incurred_triangle = False
    supports_source_selection = True
    
    @classmethod
    def get_required_params(cls):
        return []
        
    def __init__(self):
        self.results = []
        self.total_ibnr = 0
        self.total_ultimate = 0
        self.triangle = None
        self.params = {}
        self.ldfs = []
        self.cdfs = []
        self.matrix = None
        
    def fit(self, triangle, params, custom_ldfs, matrix=None):
        self.triangle = triangle
        self.params = params
        self.ldfs = custom_ldfs
        self.cdfs = triangle.compute_cdfs(self.ldfs)
        self.results = []
        self.matrix = matrix if matrix is not None else triangle.matrix
        self._compute()
        
    def _compute(self):
        raise NotImplementedError()
        
    def get_results(self):
        return self.results
        
    def get_total_ibnr(self):
        return sum(r.get('ibnr', 0) for r in self.results)
        
    def get_total_ultimate(self):
        return sum(r.get('ultimate', 0) for r in self.results)
