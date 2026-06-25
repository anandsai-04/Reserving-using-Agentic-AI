import sys
import os
import time

sys.path.append(os.path.abspath(os.path.dirname(__file__)))
import agent_workflow

with open("../data/df_masked.csv", "r") as f:
    csv_text = f.read()

t0 = time.time()
session_id = agent_workflow.create_session(
    csv_text=csv_text,
    n_years=5,
    business_context='{"tail": "Not Known", "volatility": "Not Known", "environment": "Not Known", "distortions": "Not Known"}'
)
t_session = time.time() - t0
print(f"Session Creation: {t_session:.4f}s")

t0 = time.time()
t1 = agent_workflow.ingest_csv(session_id)
t_ingest = time.time() - t0
print(f"ingest_csv: {t_ingest:.4f}s")

t0 = time.time()
t2 = agent_workflow.perform_data_quality_checks(session_id)
t_dq = time.time() - t0
print(f"perform_data_quality_checks: {t_dq:.4f}s")

t0 = time.time()
t3 = agent_workflow.build_loss_triangle(session_id)
t_triangle = time.time() - t0
print(f"build_loss_triangle: {t_triangle:.4f}s")

t0 = time.time()
t4 = agent_workflow.calculate_ldfs(session_id)
t_ldfs = time.time() - t0
print(f"calculate_ldfs: {t_ldfs:.4f}s")

t0 = time.time()
list(agent_workflow.execute_sequential_pipeline_part2(session_id))
t_part2 = time.time() - t0
print(f"execute_sequential_pipeline_part2: {t_part2:.4f}s")
