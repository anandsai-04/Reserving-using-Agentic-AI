import pandas as pd
from models.triangle import Triangle

df = pd.DataFrame({
    'accident_year': [2011, 2012, 2013],
    '12': [100, 200, 300],
    '24': [150, 250, None],
    '36': [180, None, None]
})

t = Triangle()
t._format = 'wide'
t._parse_wide(df)
t._build_matrix()
print("Success")
