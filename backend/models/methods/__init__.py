from .chain_ladder import ChainLadder
from .mack_chain_ladder import MackChainladder
from .bornhuetter_ferguson import BornhuetterFerguson
from .benktander import Benktander
from .cape_cod import CapeCod
from .case_outstanding import CaseOutstanding
from .expected_loss_ratio import ExpectedLossRatio

METHODS = {
    'CL': ChainLadder,
    'MCL': MackChainladder,
    'BF': BornhuetterFerguson,
    'BK': Benktander,
    'CC': CapeCod,
    'CO': CaseOutstanding,
    'ELR': ExpectedLossRatio
}
