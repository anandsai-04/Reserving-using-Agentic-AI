import json
from models.triangle import Triangle
import pandas as pd

with open("../dashboard/sample_auto_liability.csv", "r") as f:
    csv_text = f.read()

t = Triangle.from_csv(csv_text)
print("Accident Years:", t.accident_years)
print("Dev Ages:", t.dev_ages)
print("Matrix Row 0:", t.matrix[0] if t.matrix else "Empty")
print("LDFs:", [f['volumeWeighted'] for f in t.compute_ldfs()])
