import sys
import types
sys.modules['numpy'] = types.ModuleType('numpy')
sys.modules['pandas'] = types.ModuleType('pandas')
sys.modules['scipy'] = types.ModuleType('scipy')
from models.methods import METHODS
print('Success')
