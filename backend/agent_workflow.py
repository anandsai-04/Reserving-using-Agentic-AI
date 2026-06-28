import pandas as pd
from io import StringIO
import json
import uuid
import time
import concurrent.futures
from openai import OpenAI
import openai
import os
from models.triangle import Triangle
from models.methods import METHODS
from models.classifier import DataClassifier
from models.inspector import DataInspector
from models.compliance import ComplianceEngine

# Global Session Store
SESSION_STORE = {}

def create_session(csv_text: str, n_years: int, valuation_year: int = None, api_key: str = None, base_url: str = None, model_name: str = None, business_context: str = None) -> str:
    session_id = str(uuid.uuid4())
    SESSION_STORE[session_id] = {
        'csv_text': csv_text,
        'n_years': n_years,
        'valuation_year': valuation_year,
        'api_key': api_key,
        'base_url': base_url,
        'model_name': model_name,
        'business_context': business_context or '',
        'df': None,
        'triangle': None,
        'ldfs': None,
        'summary': None,
        'recommendation': None,
        'results': None,
        'compliance_engine': ComplianceEngine(),
        'methods_executed': set()
    }
    return session_id

# ==========================================
# TOOL FUNCTIONS
# ==========================================

def ingest_csv(session_id: str) -> str:
    """Tool for Agent 1: Converts the raw CSV data into a Pandas DataFrame, classifies it, and maps reserving roles."""
    session = SESSION_STORE.get(session_id)
    if not session: return "Error: Invalid session ID."
    
    try:
        csv_text = session['csv_text']
        df = pd.read_csv(StringIO(csv_text))
        session['df'] = df
        session['original_columns'] = list(df.columns)
        
        # 1. Run DataClassifier
        classifier = DataClassifier()
        classification = classifier.classify_from_bytes(csv_text.encode('utf-8'), "upload.csv")
        session['classification'] = classification
        
        # 2. Run DataInspector
        inspector = DataInspector(df=df, file_path="upload.csv", data_type=classification.data_type)
        inspection = inspector.inspect()
        session['inspection'] = inspection
        
        # Mapped roles from inspector
        roles = inspection.reserving_roles
        roles_desc = []
        for role_key, col in roles.items():
            if col:
                # Add accumulation state if available
                state = inspection.accumulation_states.get(col)
                state_str = f" ({state})" if state else ""
                roles_desc.append(f"{role_key} -> '{col}'{state_str}")
        roles_str = ", ".join(roles_desc) if roles_desc else "None"
        
        entity_msg = ""
        if inspection.entity_check.is_multi_entity:
            entity_msg = f" Note: Detected {inspection.entity_check.entity_count} entities under '{inspection.entity_check.entity_column}'."
            
        # Run Ingestion Compliance Checks
        session['compliance_engine'].run_ingestion_checks(df, inspection)
            
        return (f"Successfully parsed CSV ({len(df)} rows, {len(df.columns)} cols). "
                f"Classified as '{classification.data_type}' (Confidence: {classification.confidence})."
                f"{entity_msg} Mapped reserving roles: {roles_str}.")
    except Exception as e:
        return f"Failed to parse CSV: {str(e)}"

def perform_data_quality_checks(session_id: str) -> str:
    """Tool for Data Quality Agent: Performs initial data quality checks using pandas."""
    session = SESSION_STORE.get(session_id)
    if not session or session['df'] is None: return "Error: DataFrame not found. Run ingest_csv first."
    
    try:
        df = session['df']
        missing_values = df.isnull().sum()
        missing_report = ", ".join([f"{col}: {val}" for col, val in missing_values.items() if val > 0])
        total_missing = missing_values.sum()
        
        row_count = len(df)
        duplicates = df.duplicated().sum()
        
        report = f"Analyzed {row_count} rows. "
        if total_missing > 0:
            report += f"Found {total_missing} missing values ({missing_report}). "
        else:
            report += "No missing values found. "
            
        if duplicates > 0:
            report += f"Found {duplicates} duplicate rows."
            
        return report
    except Exception as e:
        return f"Failed to perform data quality checks: {str(e)}"

def build_loss_triangle(session_id: str) -> str:
    """Tool for Agent 2: Converts the Pandas DataFrame into an actuarial Loss Triangle."""
    session = SESSION_STORE.get(session_id)
    if not session or session['df'] is None: return "Error: DataFrame not found. Run ingest_csv first."
    
    try:
        val_year = session.get('valuation_year')
        inspection = session.get('inspection')
        roles = inspection.reserving_roles if inspection else {}
        t = Triangle(valuation_year=val_year, roles=roles)
        df = session['df']
        df.columns = [str(c).strip().lower() for c in df.columns]
        
        # Filter by selected entities if applicable
        selected_entities = session.get('selected_entities')
        if selected_entities and inspection and inspection.entity_check.is_multi_entity:
            ent_col = inspection.entity_check.entity_column
            col_match = next((c for c in df.columns if c.lower() == ent_col.lower()), None)
            if col_match:
                df = df[df[col_match].astype(str).isin(selected_entities)]
                
        header = list(df.columns)
        t._format = t._detect_format(header)
        if t._format == 'long':
            t._parse_long(df)
        else:
            t._parse_wide(df)
        t._build_matrix()
            
        session['triangle'] = t
        summary = t.get_summary()
        summary['original_columns'] = session.get('original_columns', [])
        
        # Extract unique entities from the original dataframe
        entities = []
        if inspection and inspection.entity_check.is_multi_entity:
            ent_col = inspection.entity_check.entity_column
            col_match = next((c for c in session['df'].columns if c.lower() == ent_col.lower()), None)
            if col_match:
                entities = sorted(session['df'][col_match].dropna().unique().astype(str).tolist())
        summary['entities'] = entities
        summary['selected_entities'] = session.get('selected_entities')
        
        classification = session.get('classification')
        if classification:
            summary['classification'] = {
                'data_type': classification.data_type,
                'confidence': classification.confidence,
                'is_cas_format': classification.is_cas_format
            }
        if inspection:
            summary['inspection'] = {
                'is_multi_entity': inspection.entity_check.is_multi_entity,
                'entity_column': inspection.entity_check.entity_column,
                'entity_count': inspection.entity_check.entity_count,
                'reserving_roles': inspection.reserving_roles,
                'accumulation_states': inspection.accumulation_states
            }
        session['summary'] = summary
        
        # Run Summary Compliance Checks
        session['compliance_engine'].run_summary_checks(df, t)
        
        return f"Successfully built {t._format} format Triangle."
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"Failed to build triangle: {str(e)}"

def calculate_ldfs(session_id: str) -> str:
    """Tool for Agent 3: Calculates Loss Development Factors (LDFs) using the user's requested n_years."""
    session = SESSION_STORE.get(session_id)
    if not session or session['triangle'] is None: return "Error: Triangle not found."
    
    try:
        t = session['triangle']
        ldfs = t.compute_ldfs()
        session['ldfs'] = ldfs
        
        inc_ldfs = t.compute_incurred_ldfs()
        session['incurred_ldfs'] = inc_ldfs
        
        n = session.get('n_years', 5)
        # Assuming we just log the n-year request, exact usage in app.js uses the 'weighted5yr' or 'straightAvg' keys.
        # We will inform the agent it was calculated.
        return f"Successfully calculated LDFs (Volume Weighted and n-year averages). Tail factor is {ldfs[-1]['volumeWeighted']}."
    except Exception as e:
        return f"Failed to calculate LDFs: {str(e)}"

def analyze_exposures_and_premiums(session_id: str) -> str:
    """Tool for Agent 5: Analyzes the premium and exposure volume data from the triangle."""
    session = SESSION_STORE.get(session_id)
    if not session or session['triangle'] is None: return "Error: Triangle not found."
    
    try:
        t = session['triangle']
        prems = t.premiums
        exps = t.exposures
        
        if not prems and not exps:
            return "No premium or exposure data found in this dataset."
            
        avg_prem = sum(prems.values()) / len(prems) if prems else 0
        return f"Premium data found across {len(prems)} accident years. Average premium: {avg_prem:.2f}. Exposures count: {len(exps)}."
    except Exception as e:
        return f"Failed to analyze premiums: {str(e)}"

def run_actuarial_model(session_id: str, method_code: str) -> str:
    """Tool for Agent 6: Executes a specific mathematical reserving model (e.g. BF, CL, MCL, CC, BK, CO, CLK)."""
    session = SESSION_STORE.get(session_id)
    if not session or session['triangle'] is None: return "Error: Triangle not found."
    
    try:
        MethodClass = METHODS.get(method_code)
        if not MethodClass: return f"Error: Invalid method code {method_code}."
        
        t = session['triangle']
        ldfs_to_use = [f['volumeWeighted'] for f in session['ldfs'][:-1]] + [1.0]
        
        model = MethodClass()
        model = MethodClass()
        params = session.get('params', {})
        model.fit(t, params, ldfs_to_use)
        
        total_ibnr = model.get_total_ibnr()
        total_ult = model.get_total_ultimate()
        
        session['results'] = {
            'method': method_code,
            'totalIBNR': total_ibnr,
            'totalUlt': total_ult
        }
        
        session['methods_executed'].add(method_code)
        
        return f"Executed {method_code}. Total IBNR calculated: {total_ibnr:.2f}."
    except Exception as e:
        return f"Failed to run model {method_code}: {str(e)}"


# ==========================================
# AGENT RUNNER UTILITY
# ==========================================

def run_agent(api_key: str, base_url: str, model_name: str, sys_inst: str, prompt: str, tools: list) -> str:
    env_api_key = os.environ.get("LLM_API_KEY")
    env_base_url = os.environ.get("LLM_BASE_URL")
    env_model_name = os.environ.get("LLM_MODEL_NAME")

    # Determine if using default/fallback settings
    is_default = (not api_key and not env_api_key) or (api_key == "ollama") or (base_url and "ngrok-free.dev" in base_url)

    # Fallbacks (UI > Environment > Hardcoded Defaults)
    api_key = api_key or env_api_key
    base_url = base_url if base_url else env_base_url
    model_name = model_name or env_model_name or "gpt-4o-mini"
    
    # Auto-correct Gemini native URL to OpenAI compatible URL
    if base_url and "generativelanguage.googleapis.com" in base_url:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif api_key and api_key.startswith("AIza") and not base_url:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        
    try:
        client = OpenAI(
            api_key=api_key, 
            base_url=base_url if base_url else None,
            default_headers={"ngrok-skip-browser-warning": "true"}
        )
    except Exception as e:
        return f"Agent Error: {str(e)}"
    
    # Speed Optimization: Default/fallback settings should fail fast to avoid blocking actuarial workbench
    timeout_val = 3.0 if is_default else 7.0
    max_attempts = 1 if is_default else 2

    # Simple retry mechanism
    for attempt in range(max_attempts):
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": sys_inst},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                timeout=timeout_val
            )
            return response.choices[0].message.content
        except openai.AuthenticationError:
            return "Agent Error: Authentication failed. Please verify your Render Environment Variables."
        except openai.RateLimitError:
            if attempt == max_attempts - 1:
                return "Agent Error: Quota/Rate limit exceeded (429). Please wait 60 seconds and try again."
            time.sleep(1)
        except openai.APIConnectionError:
            if attempt == max_attempts - 1:
                return "Agent Error: The LLM server is unreachable (API Connection Error)."
        except Exception as e:
            if attempt == max_attempts - 1:
                return f"Agent Error: {str(e)}"
            time.sleep(1)
    return "Error"

# ==========================================
# SEQUENTIAL PIPELINE EXECUTOR
# ==========================================

def execute_sequential_pipeline_part1(session_id: str, rate_changes: list = None):
    """
    Generator that yields multi-agent responses progressively. Part 1.
    """
    session = SESSION_STORE[session_id]
    api_key = session.get('api_key')
    base_url = session.get('base_url')
    model_name = session.get('model_name')
    
    def emit(agent, text):
        return json.dumps({"type": "agent", "agent": agent, "text": text}) + "\n"
    
    # 1. Run the initial parsing tools
    t1 = ingest_csv(session_id)
    t2 = perform_data_quality_checks(session_id)
    
    # Flush Cloudflare/Nginx buffer with 4KB of whitespace padding
    yield json.dumps({"type": "padding", "data": " " * 4096}) + "\n"
    
    # 2. Process Rate Changes
    t3 = build_loss_triangle(session_id)
    triangle = session.get('triangle')
    preprocessing_text = "No premium data found in dataset to on-level."
    if rate_changes and triangle and triangle.premiums:
        try:
            import pandas as pd
            from models.on_level import OnLevelPremiumCalculator
            prem_data = [{"accident_year": int(ay), "earned_premium": float(p)} for ay, p in triangle.premiums.items()]
            calc = OnLevelPremiumCalculator(pd.DataFrame(prem_data), pd.DataFrame(rate_changes))
            on_level_df = calc.calculate()
            
            # Update premiums in place before building the summary
            triangle.premiums = dict(zip(on_level_df["accident_year"], on_level_df["on_level_premium"]))
            preprocessing_text = "Action Result: Successfully calculated On-Level Premiums using the provided rate changes."
        except Exception as e:
            preprocessing_text = f"Action Result: Failed to calculate on-level premiums: {str(e)}"
    elif rate_changes:
        preprocessing_text = "Action Result: Rate changes were provided, but the uploaded dataset has no Premium column to on-level."
    else:
        preprocessing_text = "Action Result: No historical rate changes were provided."

    # 3. Run remaining tools for part 1
    t4 = calculate_ldfs(session_id)
    
    # 4. Stream Deterministic Outputs via Analysis Agent
    yield emit("Analysis Agent", f"Data Ingestion: {t1}")
    yield emit("Analysis Agent", f"Data Quality: {t2}")
    yield emit("Analysis Agent", preprocessing_text)
    yield emit("Analysis Agent", f"Triangle Builder: {t3}")
    yield emit("Analysis Agent", f"LDF Calculator: {t4}")

    # Seamlessly continue to part 2 using the newly provided context dropdowns
    yield from execute_sequential_pipeline_part2(session_id)

def compute_recommender_matrix(business_context: str, has_premium: bool, n_years: int = None) -> tuple[str, str]:
    import json
    scores = {
        "Chain Ladder (Development Method) [Code: CL / MCL]": 0,
        "Bornhuetter-Ferguson (BF) [Code: BF]": 0,
        "Cape Cod (Stanard-Buhlmann) [Code: CC]": 0,
        "Benktander [Code: BK]": 0,
        "Clark Stochastic [Code: CLK]": 0,
        "Expected Loss Ratio [Code: ELR]": 0
    }
    
    ctx = {}
    try:
        if business_context:
            ctx = json.loads(business_context)
    except:
        pass

    tail = ctx.get('tail', 'Not Known')
    vol = ctx.get('volatility', 'Not Known')
    env = ctx.get('environment', 'Not Known')
    distort = ctx.get('distortions', 'Not Known')

    if tail == "Short-tail": scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 2
    elif tail == "Long-tail":
        for m in ["Bornhuetter-Ferguson (BF) [Code: BF]", "Cape Cod (Stanard-Buhlmann) [Code: CC]", "Benktander [Code: BK]", "Expected Loss Ratio [Code: ELR]"]: scores[m] += 2
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 2

    if vol == "Stable": scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 2
    elif vol == "Volatile":
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] += 2
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] += 2
        scores["Expected Loss Ratio [Code: ELR]"] += 3
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 3

    if env == "Changing":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 4
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] += 1
    elif env == "Stable":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 1

    if distort == "Present":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 3
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] += 1
        scores["Expected Loss Ratio [Code: ELR]"] += 2
    elif distort == "None":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 1

    if n_years is not None:
        if n_years >= 7:
            scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 2
        elif n_years < 7:
            for m in ["Bornhuetter-Ferguson (BF) [Code: BF]", "Cape Cod (Stanard-Buhlmann) [Code: CC]", "Benktander [Code: BK]", "Expected Loss Ratio [Code: ELR]"]: scores[m] += 2
            scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 2

    if not has_premium:
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] = -999
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] = -999
        scores["Benktander [Code: BK]"] = -999
        scores["Expected Loss Ratio [Code: ELR]"] = -999

    best_model = max(scores, key=scores.get)
    
    reasons = []
    if n_years is not None: reasons.append(f"the data has {n_years} historical years")
    if tail != "Not Known": reasons.append(f"the line is {tail}")
    if vol != "Not Known": reasons.append(f"the data is {vol}")
    if env != "Not Known": reasons.append(f"the environment is {env}")
    if distort != "Not Known": reasons.append(f"distortions are {distort}")
    
    if not has_premium and best_model not in ["Bornhuetter-Ferguson (BF) [Code: BF]", "Cape Cod (Stanard-Buhlmann) [Code: CC]", "Benktander [Code: BK]"]:
        reasons.append("premium data is unavailable")

    reason_str = "based on your responses" if not reasons else "because " + " and ".join(reasons)
    
    # Sort models by score descending, filter out -999
    valid_models = {k: v for k, v in scores.items() if v > -900}
    sorted_models = sorted(valid_models.items(), key=lambda item: item[1], reverse=True)
    
    return sorted_models, reason_str

def execute_sequential_pipeline_part2(session_id: str, conditions: dict = None):
    """
    Generator that yields multi-agent responses progressively. Part 2.
    """
    session = SESSION_STORE[session_id]
    api_key = session['api_key']
    base_url = session.get('base_url')
    model_name = session.get('model_name')
    
    def emit(agent, text):
        return json.dumps({"type": "agent", "agent": agent, "text": text}) + "\n"

    has_premium = bool(session.get('triangle') and session['triangle'].premiums)
    business_context = session.get('business_context', '')
    n_years = session.get('n_years')
    
    sorted_models, matrix_reason = compute_recommender_matrix(business_context, has_premium, n_years)
    
    best_model = sorted_models[0][0] if sorted_models else "None"
    
    # Construct mechanical HTML response
    md_lines = [
        f"<b>Mechanical Matrix Recommendation</b>",
        f"<br/>The optimal method is <b>{best_model}</b>, {matrix_reason}.",
        f"<br/><br/><b>Model Compatibility Scores:</b><br/>",
        f"<i>(Higher is better. Incompatible models are hidden)</i><br/><ul style='margin-top: 8px;'>"
    ]
    for model, score in sorted_models:
        md_lines.append(f"<li><b>{model}</b>: {score} points</li>")
    md_lines.append("</ul>")
        
    recommender_text = "".join(md_lines)
    yield emit("Recommender Agent", "I have analyzed the data and provided a model recommendation in the main panel.")

    # Final Payload
    updated_session = SESSION_STORE.get(session_id)
    triangle = updated_session.get('triangle')
    triangle_data = None
    if triangle:
        from models.tools import compute_suggested_elr, compute_mature_accident_years, compute_method_availability
        mature_info = compute_mature_accident_years(triangle)
        triangle_data = {
            "accidentYears": triangle.accident_years,
            "devAges": triangle.dev_ages,
            "matrix": triangle.matrix,
            "incurred_matrix": triangle.incurred_matrix,
            "ldfs": updated_session.get('ldfs'),
            "incurred_ldfs": updated_session.get('incurred_ldfs'),
            "hasPremium": bool(triangle.premiums),
            "suggested_elr_paid": compute_suggested_elr(triangle, "paid"),
            "suggested_elr_incurred": compute_suggested_elr(triangle, "incurred"),
            "suggested_mature_years": mature_info.get("mature_years", []),
            "mature_reasoning": mature_info.get("reasoning", {}),
            "method_availability": compute_method_availability(triangle)
        }
        
    yield json.dumps({
        "type": "complete",
        "session_id": session_id,
        "summary": updated_session.get('summary'),
        "triangle": triangle_data,
        "recommendation": recommender_text
    }) + "\n"

def run_reserve_recommendation_agent(session_id: str, results_summary: list) -> dict:
    """Invokes the Reserve Recommender Agent to recommend the best method based on comparative outcomes."""
    session = SESSION_STORE.get(session_id)
    if not session:
        return {
            "recommended_method": "None",
            "confidence": "Low",
            "reasoning": ["Session expired or not found."]
        }
        
    api_key = session.get('api_key')
    base_url = session.get('base_url')
    model_name = session.get('model_name')
    
    summary_data = json.dumps(results_summary, indent=2)
    
    sys_inst = (
        "You are an expert actuarial AI Reserving Recommender. You analyze loss reserving outputs "
        "across multiple methods (Chain Ladder, Mack, BF, Benktander, Cape Cod, Case Outstanding, Clark) "
        "and recommend the most appropriate method for the best estimate. "
        "Provide your recommendation in strict JSON format containing three fields:\n"
        "1. 'recommended_method': The code of the method (e.g. 'BK', 'BF', 'CL', 'MCL', 'CC')\n"
        "2. 'confidence': The confidence level ('High', 'Medium', 'Low')\n"
        "3. 'reasoning': An array of strings with key reasons for the recommendation. Do not exceed 4 reasons.\n"
        "Respond ONLY with the raw JSON string. Do not include markdown code block formatting (like ```json)."
    )
    
    prompt = (
        f"Here are the calculated reserving indications for the current session:\n{summary_data}\n\n"
        "Review these indications. Choose the best estimate method based on: stability of IBNR, "
        "maturity score (immature years favor BF/BK, mature favor CL/Mack), volatility of Chain Ladder, "
        "and Reserve-to-Case Ratio. Return the JSON recommendation."
    )
    
    raw_response = run_agent(api_key, base_url, model_name, sys_inst, prompt, [])
    
    # Try parsing JSON
    try:
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines)
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
        return json.loads(cleaned)
    except Exception as e:
        # Fallback heuristic recommendation if LLM fails
        best_method = "CL"
        for r in results_summary:
            if r.get('status') == 'success' and r.get('code') in ['BK', 'BF', 'CC']:
                best_method = r['code']
                break
        return {
            "recommended_method": best_method,
            "confidence": "Medium",
            "reasoning": [
                "Auto-fallback heuristic recommendation",
                "Favored credibility method (BK/BF/CC) over raw Chain Ladder for stability.",
                f"Parsing details: {str(e)}"
            ]
        }
        
# ==========================================
# SINGLE MODEL DEEP DIVE REPORT AGENT
# ==========================================

def generate_single_model_report(session_id: str, method_code: str) -> str:
    session = SESSION_STORE.get(session_id)
    if not session:
        return "Error: Session expired or invalid."
    
    api_key = session.get('api_key', '')
    base_url = session.get('base_url', '')
    model_name = session.get('model_name', '')
    
    results = session.get('results', {})
    methods_out = results.get('methods', [])
    
    # Find the requested method
    method_data = next((m for m in methods_out if (m.get('code') == method_code or m.get('result_id') == method_code)), None)
    if not method_data:
        return f"Error: No results found for method {method_code}."
    
    # Extract historical trends
    trends_summary = ""
    for r in method_data.get('results', []):
        ay = r.get('ay')
        paid = float(r.get('paid', 0))
        ultimate = float(r.get('ultimate', 0))
        ibnr = float(r.get('ibnr', 0))
        pct_reported = float(r.get('pctReported', 0))
        trends_summary += f"AY {ay}: Paid={paid:.0f}, Ultimate={ultimate:.0f}, IBNR={ibnr:.0f}, %Reported={pct_reported:.1f}%\n"
    
    diagnostics = session.get('diagnostics', {})
    weibull_fit = diagnostics.get('weibull_fit', {})
    
    # We don't want to pass massive raw matrices to the LLM, just the summaries.
    diag_summary = ""
    if weibull_fit:
        diag_summary += f"- Weibull Curve Fit: Theta = {weibull_fit.get('theta')}, Omega = {weibull_fit.get('omega')}, SSE = {weibull_fit.get('sse')}\n"
    if 'curve_fitting' in diagnostics:
        diag_summary += f"- LDF Curve Fitting R-Squareds: {json.dumps(diagnostics.get('curve_fitting', {}))}\n"
    if 'overall' in diagnostics:
        diag_summary += f"- Overall Metrics: {json.dumps(diagnostics.get('overall', {}))}\n"
    if 'volume_trends' in diagnostics:
        diag_summary += f"- Volume Trends: {json.dumps(diagnostics.get('volume_trends', {}))}\n"
        
    # Also pass the full diagnostics object (with heavy matrices pruned)
    import copy
    pruned_diag = copy.deepcopy(diagnostics)
    if 'weibull_fit' in pruned_diag and 'raw_points' in pruned_diag['weibull_fit']:
        del pruned_diag['weibull_fit']['raw_points']
    if 'weibull_fit' in pruned_diag and 'fitted_curve' in pruned_diag['weibull_fit']:
        del pruned_diag['weibull_fit']['fitted_curve']
    if 'ratio_triangles' in pruned_diag:
        # Just send the latest diagonal of the ratios to save tokens
        ratio_diag = {}
        for k, tri in pruned_diag['ratio_triangles'].items():
            latest = []
            for row in tri:
                valid = [v for v in reversed(row) if v is not None]
                if valid:
                    latest.append(valid[0])
            ratio_diag[k + '_latest_diagonal'] = latest
        pruned_diag['ratio_summary'] = ratio_diag
        del pruned_diag['ratio_triangles']

    sys_inst = (
        "You are an expert actuarial AI assistant. Your task is to generate a detailed, professional "
        "Markdown report analyzing a specific reserving method's results for a given dataset."
    )
    
    import json
    prompt = (
        f"Generate a deep dive actuarial report for the '{method_code}' method.\n\n"
        f"Total Calculated Ultimate: {method_data.get('ultimate', 0):.2f}\n"
        f"Total Calculated IBNR: {method_data.get('ibnr', 0):.2f}\n\n"
        f"Historical Trends by Accident Year:\n{trends_summary}\n\n"
        f"Global Dataset Diagnostics:\n{json.dumps(pruned_diag, indent=2)}\n\n"
        "Your report must be structured in clear Markdown and cover:\n"
        "1. **Methodology Overview**: A brief summary of how this specific method works.\n"
        "2. **Results Interpretation**: Analyze the IBNR and Ultimate distributions across the accident years. Are there any notable patterns (e.g., highly leveraged immature years, or stable mature years)?\n"
        "3. **Reporting Pattern Analysis**: Analyze the % Reported across years and explicitly discuss the Weibull curve fit (Theta/Omega). Does the settlement speed seem reasonable?\n"
        "4. **Diagnostic Deep Dive**: Analyze the Paid vs Incurred ratios and Settlement Rates provided in the diagnostics. Do these metrics align with the method's assumptions?\n"
        "5. **Strengths & Limitations**: What are the specific strengths and weaknesses of using THIS method on this profile?\n\n"
        "Use professional actuarial tone. Do not use generic introductions. Dive straight into the report."
    )
    
    try:
        raw_response = run_agent(api_key, base_url, model_name, sys_inst, prompt, [])
        return raw_response
    except Exception as e:
        return f"Failed to generate report for {method_code}: {str(e)}"


# ==========================================
# PARALLEL CHAT AGENT
# ==========================================

def run_parallel_chat(session_id: str, message: str, history: list) -> str:
    """Agent that sits parallel to the pipeline, with access to all data and tools."""
    session = SESSION_STORE.get(session_id)
    if not session: return "Error: Session expired."
    
    try:
        from models.diagnostics import compute_diagnostics
        t = session.get('triangle')
        diag_metrics = compute_diagnostics(t) if t else {}
        
        # Prune large matrices to significantly reduce token usage
        if 'ratio_triangles' in diag_metrics:
            for key in ['paid_to_incurred', 'settlement_rate']:
                matrix = diag_metrics['ratio_triangles'].get(key, [])
                if matrix and isinstance(matrix, list) and len(matrix) > 0 and isinstance(matrix[0], list):
                    cols = len(matrix[0])
                    avgs = []
                    for c in range(cols):
                        col_vals = [matrix[r][c] for r in range(len(matrix)) if c < len(matrix[r]) and matrix[r][c] is not None]
                        avgs.append(round(sum(col_vals)/len(col_vals), 3) if col_vals else None)
                    diag_metrics['ratio_triangles'][key] = {"average_by_development_age": avgs, "note": "Full matrix compressed to averages to save tokens."}
    except Exception:
        diag_metrics = {}
        
    context = {
        'n_years': session.get('n_years'),
        'summary': session.get('summary'),
        'results': session.get('results'),
        'ldfs_curve': session.get('ldfs'),
        'cdfs_curve': session.get('cdfs'),
        'development_ages_months': session.get('dev_ages'),
        'total_ibnr': session.get('totalIBNR'),
        'execution_report': session.get('report'),
        'diagnostics': diag_metrics
    }
    
    sys_inst = f"""You are the Analysis Chat Agent, an expert actuary. You have studied the book 'Estimating Unpaid Claims Using Basic Techniques' by Jacqueline Friedland in immense detail.
Context: {json.dumps(context)}
Rules:
1. If asked about diagnostics, provide a detailed report analyzing the curves of loss ratios, development ratios, and settlement rates using the 'diagnostics' object. Reference Friedland's methodologies explicitly.
2. For Curve Fitting, explain the mathematical fit for Pareto, Weibull, and Loglogistic distributions using the tail factors.
3. Provide a detailed analysis of the Paid-to-Incurred ratio triangle to detect Case Reserve adequacy trends.
4. Provide a detailed report of Settlement Rates (Closed vs Reported claims).
5. Explain your chosen Tail Factor using the execution_report.
6. If asked to on-level premiums, use tool 'calculate_on_level_premiums'.
7. SCOPE RESTRICTION: You may ONLY answer questions related to actuarial reserving, loss development methodology, or the data and results in the current session. If a user asks anything outside this scope (e.g. general knowledge, coding, current events, personal advice), politely decline and redirect them: 'I am scoped to actuarial reserving analysis for this session. Please ask me about your loss triangle, IBNR results, LDF selection, or reserving methodology.'
Be concise and actuarially precise."""
    
    api_key = session.get('api_key')
    base_url = session.get('base_url')
    model_name = session.get('model_name')
    if not model_name: model_name = "gpt-4o-mini"
    env_api_key = os.environ.get("LLM_API_KEY")
    env_base_url = os.environ.get("LLM_BASE_URL")
    env_model_name = os.environ.get("LLM_MODEL_NAME")

    # Fallbacks (UI > Environment > Hardcoded Defaults)
    api_key = api_key or env_api_key
    base_url = base_url if base_url else env_base_url
    model_name = model_name or env_model_name or "gpt-4o-mini"
    
    if not api_key: return "Chat Agent Error: No API key provided."
    
    # Auto-route Gemini API keys to the correct Google endpoint if not specified
    if api_key and api_key.startswith("AIza") and not base_url:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif base_url and "generativelanguage.googleapis.com" in base_url:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"

    messages = [{"role": "system", "content": sys_inst}]
    for msg in history:
        role = 'user' if msg['role'] == 'user' else 'assistant'
        messages.append({"role": role, "content": msg['text']})
    messages.append({"role": "user", "content": message})
    
    tools = [
        {
            "type": "function",
            "function": {
                "name": "calculate_on_level_premiums",
                "description": "Calculates on-level premiums using historical rate changes and the currently active premium dataset.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "rate_changes": {
                            "type": "array",
                            "description": "Array of rate changes.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "effective_date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                                    "rate_change": {"type": "number", "description": "Rate change as a decimal (e.g. 0.05 for +5%)"}
                                },
                                "required": ["effective_date", "rate_change"]
                            }
                        }
                    },
                    "required": ["rate_changes"]
                }
            }
        }
    ]
    
    try:
        client = OpenAI(
            api_key=api_key, 
            base_url=base_url if base_url else None,
            default_headers={"ngrok-skip-browser-warning": "true"}
        )
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            tools=tools,
            temperature=0.5
        )
        
        response_msg = response.choices[0].message
        
        if response_msg.tool_calls:
            messages.append(response_msg)
            for tool_call in response_msg.tool_calls:
                if tool_call.function.name == "calculate_on_level_premiums":
                    args = json.loads(tool_call.function.arguments)
                    rc_list = args.get("rate_changes", [])
                    
                    triangle = session.get('triangle')
                    if not triangle or not triangle.premiums:
                        tool_result = "Error: No premium data available in the current dataset to on-level."
                    else:
                        try:
                            import pandas as pd
                            from models.on_level import OnLevelPremiumCalculator
                            prem_data = [{"accident_year": int(ay), "earned_premium": float(p)} for ay, p in triangle.premiums.items()]
                            calc = OnLevelPremiumCalculator(pd.DataFrame(prem_data), pd.DataFrame(rc_list))
                            on_level_df = calc.calculate()
                            tool_result = on_level_df.to_json(orient="records")
                        except Exception as e:
                            tool_result = f"Error computing on-level premiums: {str(e)}"
                            
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_call.function.name,
                        "content": tool_result
                    })
            
            final_response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=0.5
            )
            return final_response.choices[0].message.content
        else:
            return response_msg.content
    except openai.AuthenticationError:
        return "Chat Agent Error: Authentication failed. Please verify your Render Environment Variables."
    except openai.RateLimitError:
        return "Chat Agent Error: Quota/Rate limit exceeded. Please wait a moment."
    except openai.APIConnectionError:
        return "Chat Agent Error: The LLM server is unreachable."
    except Exception as e:
        return f"Chat Agent Error: {str(e)}"
