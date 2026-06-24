import sys
import os
from pathlib import Path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
import agent_workflow

DATA_FILE = Path(__file__).resolve().parents[1] / "frontend" / "public" / "df_masked.csv"

with DATA_FILE.open("r") as f:
    csv_text = f.read()

session_id = agent_workflow.create_session(
    csv_text=csv_text,
    n_years=5
)

# Run the ingestion step (which now incorporates the DataClassifier & DataInspector)
result = agent_workflow.ingest_csv(session_id)
print("======================================================================")
print("STEP 1: COLUMNS CLASSIFICATION & INSPECTION VERIFICATION")
print("======================================================================")
print("Ingestion Return message:\n", result)
print("----------------------------------------------------------------------")

session = agent_workflow.SESSION_STORE[session_id]
classification = session.get('classification')
inspection = session.get('inspection')

if classification and inspection:
    print("Classification & Inspection Success!")
    print("Detected Data Type:", classification.data_type)
    print("Confidence Level:", classification.confidence)
    print("Is CAS Format Schema:", classification.is_cas_format)
    print("Is Multi-Entity:", inspection.entity_check.is_multi_entity)
    if inspection.entity_check.is_multi_entity:
        print(f"  - Entity Column: '{inspection.entity_check.entity_column}'")
        print(f"  - Entity Count: {inspection.entity_check.entity_count}")
    
    print("\nDetailed Mapped Reserving Columns:")
    for role, col in inspection.reserving_roles.items():
        if col:
            state = inspection.accumulation_states.get(col, "indeterminate")
            print(f"  - {role}: '{col}' | Accumulation State: {state}")
        else:
            print(f"  - {role}: None")
else:
    print("Error: Missing classification or inspection results in session.")
print("======================================================================")
