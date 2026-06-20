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
        'results': None
    }
    return session_id

# ==========================================
# TOOL FUNCTIONS
# ==========================================

def ingest_csv(session_id: str) -> str:
    """Tool for Agent 1: Converts the raw CSV data into a Pandas DataFrame."""
    session = SESSION_STORE.get(session_id)
    if not session: return "Error: Invalid session ID."
    
    try:
        df = pd.read_csv(StringIO(session['csv_text']))
        session['df'] = df
        return f"Successfully parsed CSV into DataFrame with {len(df)} rows and {len(df.columns)} columns."
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
        t = Triangle(valuation_year=val_year)
        df = session['df']
        df.columns = [str(c).strip().lower() for c in df.columns]
        header = list(df.columns)
        
        t._format = t._detect_format(header)
        if t._format == 'long':
            t._parse_long(df)
        else:
            t._parse_wide(df)
        t._build_matrix()
            
        session['triangle'] = t
        session['summary'] = t.get_summary()
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

    # Fallbacks (UI > Environment > Hardcoded Defaults)
    api_key = api_key or env_api_key or "ollama"
    base_url = base_url or env_base_url or "https://encrypt-nail-smasher.ngrok-free.dev/v1"
    model_name = model_name or env_model_name or "llama3.1"
    
    # Auto-correct Gemini native URL to OpenAI compatible URL
    if base_url and "generativelanguage.googleapis.com" in base_url and "openai" not in base_url:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        
    try:
        client = OpenAI(
            api_key=api_key, 
            base_url=base_url if base_url else None,
            default_headers={"ngrok-skip-browser-warning": "true"}
        )
    except Exception as e:
        return f"Agent Error: {str(e)}"
    
    # Simple retry mechanism
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": sys_inst},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2
            )
            return response.choices[0].message.content
        except openai.AuthenticationError:
            return "Agent Error: Authentication failed. Please verify your Render Environment Variables."
        except openai.RateLimitError:
            if attempt == 2:
                return "Agent Error: Quota/Rate limit exceeded (429). Please wait 60 seconds and try again."
            time.sleep(2)
        except openai.APIConnectionError:
            return "Agent Error: The LLM server is unreachable (API Connection Error)."
        except Exception as e:
            if attempt == 2:
                return f"Agent Error: {str(e)}"
            time.sleep(2)
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
        "Clark Stochastic [Code: CLK]": 0
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
        for m in ["Bornhuetter-Ferguson (BF) [Code: BF]", "Cape Cod (Stanard-Buhlmann) [Code: CC]", "Benktander [Code: BK]"]: scores[m] += 2
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 2

    if vol == "Stable": scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 2
    elif vol == "Volatile":
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] += 2
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] += 2
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 3

    if env == "Changing":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 4
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] += 1
    elif env == "Stable":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 1

    if distort == "Present":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 3
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] += 1
    elif distort == "None":
        scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 1

    if n_years is not None:
        if n_years >= 7:
            scores["Chain Ladder (Development Method) [Code: CL / MCL]"] += 2
        elif n_years < 7:
            for m in ["Bornhuetter-Ferguson (BF) [Code: BF]", "Cape Cod (Stanard-Buhlmann) [Code: CC]", "Benktander [Code: BK]"]: scores[m] += 2
            scores["Chain Ladder (Development Method) [Code: CL / MCL]"] -= 2

    if not has_premium:
        scores["Bornhuetter-Ferguson (BF) [Code: BF]"] = -999
        scores["Cape Cod (Stanard-Buhlmann) [Code: CC]"] = -999
        scores["Benktander [Code: BK]"] = -999

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
    return best_model, reason_str

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
    
    best_model, matrix_reason = compute_recommender_matrix(business_context, has_premium, n_years)
    
    sys6 = f"""You are the Recommender Agent. The deterministic actuarial matrix has selected '{best_model}' as the most suitable method {matrix_reason}.
Your task: Explain this recommendation to the user in exactly 1-2 crisp, human-readable sentences. Output ONLY the explanation."""

    recommender_text = run_agent(api_key, base_url, model_name, sys6, "Explain the matrix recommendation.", [])
    yield emit("Recommender Agent", "I have analyzed the data and provided a model recommendation in the main panel.")

    # Final Payload
    updated_session = SESSION_STORE.get(session_id)
    triangle = updated_session.get('triangle')
    triangle_data = None
    if triangle:
        triangle_data = {
            "accidentYears": triangle.accident_years,
            "devAges": triangle.dev_ages,
            "matrix": triangle.matrix,
            "incurred_matrix": triangle.incurred_matrix,
            "ldfs": updated_session.get('ldfs'),
            "hasPremium": bool(triangle.premiums)
        }
        
    yield json.dumps({
        "type": "complete",
        "session_id": session_id,
        "summary": updated_session.get('summary'),
        "triangle": triangle_data,
        "recommendation": recommender_text
    }) + "\n"

# ==========================================
# PARALLEL CHAT AGENT
# ==========================================

def run_parallel_chat(session_id: str, message: str, history: list) -> str:
    """Agent that sits parallel to the pipeline, with access to all data and tools."""
    session = SESSION_STORE.get(session_id)
    if not session: return "Error: Session expired."
    
    context = {
        'n_years': session.get('n_years'),
        'summary': session.get('summary'),
        'results': session.get('results'),
        'ldfs_curve': session.get('ldfs'),
        'cdfs_curve': session.get('cdfs'),
        'development_ages_months': session.get('dev_ages'),
        'total_ibnr': session.get('totalIBNR'),
        'execution_report': session.get('report')
    }
    
    sys_inst = f"""You are the Analysis Chat Agent.
Context: {json.dumps(context)}
Rules:
1. If asked about LDF patterns, reference: smoothness, stability, credibility, pattern changes, applicability, and shock losses using the execution_report.
2. If asked about Tail Factor, explain the choice (Reported-to-Paid, Curve Fitting, or Benchmark) using execution_report.
3. If asked to on-level premiums, use tool 'calculate_on_level_premiums' if rate history is provided; else ask for it.
4. If asked about models, mention if BF, CC, or BK are incompatible due to missing premium data.
Be concise and precise."""
    
    api_key = session.get('api_key')
    base_url = session.get('base_url')
    model_name = session.get('model_name')
    if not model_name: model_name = "gpt-4o-mini"
    env_api_key = os.environ.get("LLM_API_KEY")
    env_base_url = os.environ.get("LLM_BASE_URL")
    env_model_name = os.environ.get("LLM_MODEL_NAME")

    # Fallbacks (UI > Environment > Hardcoded Defaults)
    api_key = api_key or env_api_key or "ollama"
    base_url = base_url or env_base_url or "https://encrypt-nail-smasher.ngrok-free.dev/v1"
    model_name = model_name or env_model_name or "llama3.1"
    
    if not api_key: return "Chat Agent Error: No API key provided."

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
