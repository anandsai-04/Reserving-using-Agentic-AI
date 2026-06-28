from .chain_ladder import ChainLadder
from .bornhuetter_ferguson import BornhuetterFerguson
from .benktander import Benktander
from .cape_cod import CapeCod
from .case_outstanding import CaseOutstanding
from .expected_loss_ratio import ExpectedLossRatio

METHODS = {
    'CL': ChainLadder,
    'BF': BornhuetterFerguson,
    'BK': Benktander,
    'CC': CapeCod,
    'CO': CaseOutstanding,
    'ELR': ExpectedLossRatio
}
