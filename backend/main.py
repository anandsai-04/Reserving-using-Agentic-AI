from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import json
from typing import Dict, Any, Optional

import agent_workflow

app = FastAPI(title="Agentic Actuarial Reserving Backend")

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExecuteRequest(BaseModel):
    session_id: str
    method_code: str
    params: Dict[str, Any]
    custom_ldfs: list
    rate_changes: Optional[list] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: list
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None

class ResumePipelineRequest(BaseModel):
    session_id: str
    conditions: Optional[Dict[str, bool]] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None

class UpdateMappingsRequest(BaseModel):
    session_id: str
    reserving_roles: Dict[str, Optional[str]]
    selected_entities: Optional[list] = None

from fastapi.responses import StreamingResponse

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...), 
    api_key: str = Form(None),
    base_url: str = Form(None),
    model_name: str = Form(None),
    n_years: int = Form(5),
    valuation_year: int = Form(None),
    rate_changes_json: str = Form(None),
    business_context: str = Form(None)
):
    content = await file.read()
    csv_text = content.decode('utf-8')
    
    rate_changes = None
    if rate_changes_json:
        try:
            rate_changes = json.loads(rate_changes_json)
        except:
            pass
            
    try:
        session_id = agent_workflow.create_session(csv_text, n_years, valuation_year, api_key, base_url, model_name, business_context)
        
        return StreamingResponse(
            agent_workflow.execute_sequential_pipeline_part1(session_id, rate_changes),
            media_type="text/event-stream"
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/resume_pipeline")
async def resume_pipeline(req: ResumePipelineRequest):
    session = agent_workflow.SESSION_STORE.get(req.session_id)
    if session:
        if req.api_key: session['api_key'] = req.api_key
        if req.base_url: session['base_url'] = req.base_url
        if req.model_name: session['model_name'] = req.model_name

    return StreamingResponse(
        agent_workflow.execute_sequential_pipeline_part2(req.session_id, req.conditions),
        media_type="text/event-stream"
    )

@app.post("/api/update_mappings")
async def update_mappings(req: UpdateMappingsRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session:
            return {"success": False, "error": "Invalid session_id"}
        session['selected_entities'] = req.selected_entities
        
        # Update mappings in inspection results
        inspection = session.get('inspection')
        if inspection:
            for k, v in req.reserving_roles.items():
                inspection.reserving_roles[k] = v
        else:
            from models.inspector import InspectionResult, EntityCheckResult
            session['inspection'] = InspectionResult(
                columns=[],
                entity_check=EntityCheckResult(is_multi_entity=False, entity_column=None, entity_count=0, reasons=[]),
                row_count=len(session['df']),
                column_count=len(session['df'].columns),
                reserving_roles=req.reserving_roles
            )

        # Re-build the triangle
        t_msg = agent_workflow.build_loss_triangle(req.session_id)
        if t_msg.startswith("Failed"):
            return {"success": False, "error": t_msg}

        # Re-calculate LDFs
        ldf_msg = agent_workflow.calculate_ldfs(req.session_id)
        if ldf_msg.startswith("Failed"):
            return {"success": False, "error": ldf_msg}

        # Format and return new triangle and summary
        triangle = session.get('triangle')
        triangle_data = None
        if triangle:
            triangle_data = {
                "accidentYears": triangle.accident_years,
                "devAges": triangle.dev_ages,
                "matrix": triangle.matrix,
                "incurred_matrix": triangle.incurred_matrix,
                "ldfs": session.get('ldfs'),
                "hasPremium": bool(triangle.premiums)
            }
            
        return {
            "success": True,
            "summary": session.get('summary'),
            "triangle": triangle_data
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/execute")
async def execute_model(req: ExecuteRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session:
            return {"success": False, "error": "Invalid session_id"}

        session['params'] = req.params
        session['custom_ldfs'] = req.custom_ldfs
        if req.api_key: session['api_key'] = req.api_key
        if req.base_url: session['base_url'] = req.base_url
        if req.model_name: session['model_name'] = req.model_name

        from models.methods import METHODS
        from models.tools import (get_environment_sensitivity, compute_ibnr_table,
                                   compute_loss_ratios, suggest_elr,
                                   compute_ldf_stability, compute_tail_factor)

        MethodClass = METHODS.get(req.method_code)
        if not MethodClass:
            return {"success": False, "error": "Invalid method code"}

        if MethodClass.needs_premium and not session['triangle'].premiums:
            error_msg = (f"Data Input Insufficient: The {MethodClass.label} model requires "
                         f"Premium data, which was not found in your dataset. Please choose a different model.")
            session['report'] = error_msg
            return {"success": True, "results": [], "totalIBNR": 0, "totalUlt": 0, "totalPaid": 0, "narration": error_msg}

        import copy
        t_eval = copy.deepcopy(session['triangle'])

        # ── On-Level Premium (if rate changes provided) ───────────────────────
        olf_note = ""
        if req.rate_changes and t_eval.premiums:
            try:
                import pandas as pd
                from models.on_level import OnLevelPremiumCalculator
                prem_data = [{"accident_year": int(ay), "earned_premium": float(p)} for ay, p in t_eval.premiums.items()]
                calc = OnLevelPremiumCalculator(pd.DataFrame(prem_data), pd.DataFrame(req.rate_changes))
                on_level_df = calc.calculate()
                t_eval.premiums = dict(zip(on_level_df["accident_year"], on_level_df["on_level_premium"]))
                olf_note = "Premiums were adjusted to current rate levels using On-Level Factors (OLF) before projection."
            except Exception as e:
                return {"success": False, "error": f"On-Leveling error: {str(e)}"}

        # ── TOOL: Tail Factor (deterministic) ─────────────────────────────────
        tail_result = compute_tail_factor(req.custom_ldfs, t_eval)
        chosen_tail   = tail_result["chosen"]
        chosen_reason = tail_result["reason"]
        if req.custom_ldfs[-1] == 1.0:
            req.custom_ldfs[-1] = chosen_tail
        else:
            chosen_reason = f"User Manual Override ({req.custom_ldfs[-1]})"

        # ── Run Model ─────────────────────────────────────────────────────────
        model = MethodClass()
        model.fit(t_eval, req.params, req.custom_ldfs)

        diag       = t_eval.get_latest_diagonal()
        total_paid = sum(v for v in diag if v is not None)

        # ── TOOL: IBNR Table (deterministic) ──────────────────────────────────
        ibnr_table = compute_ibnr_table(t_eval, model, req.custom_ldfs)

        # ── TOOL: Loss Ratios (deterministic, only if premium) ────────────────
        loss_ratios = compute_loss_ratios(t_eval, ibnr_table) if t_eval.premiums else []

        # ── TOOL: Suggested ELR (deterministic) ───────────────────────────────
        elr_suggestion = suggest_elr(t_eval)

        # ── TOOL: LDF Stability Diagnostics (deterministic) ───────────────────
        ldf_stability  = compute_ldf_stability(t_eval)

        # ── TOOL: Environment Sensitivity (deterministic lookup) ──────────────
        env_sensitivity = get_environment_sensitivity(req.method_code)

        # ── PROCESS descriptions (static strings — no LLM needed) ────────────
        PROCESS_EXPLANATIONS = {
            "CL":  "Chain Ladder projects ultimate claims by multiplying the latest paid diagonal by Cumulative Development Factors (CDFs) derived from historical age-to-age LDFs. IBNR = Ultimate − Paid.",
            "MCL": "Mack Chain Ladder calculates identical ultimates to CL but additionally computes sigma-squared variance for each column, producing standard errors and confidence intervals (75th/95th percentile) around the IBNR estimate.",
            "BF":  "Bornhuetter-Ferguson splits the IBNR into (a) expected unreported claims = Expected Ultimate × (1 − 1/CDF), plus (b) actual paid to date. Expected Ultimate = Premium × A Priori ELR.",
            "CC":  "Cape Cod derives the ELR automatically from actual data: ELR = Σ(Reported Claims) / Σ(Used-Up Premium). Used-Up Premium = Earned Premium × % Reported (1/CDF). IBNR is then computed identically to BF.",
            "BK":  "Benktander iteratively refines the BF estimate: BF Ultimate is fed back as the new A Priori, and IBNR is recomputed. Each iteration shifts credibility from BF toward Chain Ladder proportional to % reported.",
            "CO":  "Case Outstanding method sets IBNR = total case reserves currently held by adjusters. It assumes zero future newly-reported claims. Reserve = Incurred − Paid = Case Reserves.",
            "CLK": "Clark Stochastic fits a continuous growth curve (Log-Logistic or Weibull) to the paid triangle using maximum likelihood. Stabilised CDFs from the curve are applied to project ultimates with a distribution of outcomes."
        }

        # ── LEAN Agent Prompt (~100 tokens instead of ~500) ───────────────────
        sys_inst = (
            "You are the Analysis Agent. All numbers have been pre-computed by deterministic Python functions. "
            "Return ONLY a pure JSON object with these keys: "
            "inputs (1 sentence listing what data was used), "
            "process (copy the PROCESS field word-for-word, append OLF note if provided), "
            "output_text (1 sentence summary of total IBNR and Ultimate), "
            "ldf_analysis (detailed 6-criteria LDF analysis referencing the stability data provided), "
            "tail_factor_selection (explain the chosen tail factor method and value), "
            "impact (2 sentences on how premium/exposure changes affect this model). "
            "Do NOT calculate anything. Do NOT output environment_sensitivity — it is pre-computed. "
            "Output only the JSON object, no markdown."
        )

        sneak_peek = {
            "Method": req.method_code,
            "PROCESS": PROCESS_EXPLANATIONS.get(req.method_code, ""),
            "OLF_NOTE": olf_note,
            "Total_Paid": round(total_paid, 0),
            "Total_IBNR": round(model.get_total_ibnr(), 0),
            "Total_Ultimate": round(model.get_total_ultimate(), 0),
            "Has_Premium": bool(session['triangle'].premiums),
            "Selected_LDFs": req.custom_ldfs,
            "Tail_Chosen": chosen_reason,
            "LDF_Stability": ldf_stability,  # CoV, credibility per column — not full grid
        }

        prompt = f"Pre-computed data for your report: {json.dumps(sneak_peek)}"
        msg = agent_workflow.run_agent(req.api_key, req.base_url, req.model_name, sys_inst, prompt, [])

        # Inject the pre-computed sensitivity back into the parsed report
        try:
            import re
            parsed = json.loads(msg)
        except Exception:
            # If JSON parse fails, try stripping markdown fences
            try:
                clean = re.sub(r'^```[a-z]*\n?', '', msg.strip(), flags=re.MULTILINE)
                clean = re.sub(r'```$', '', clean.strip())
                parsed = json.loads(clean)
            except Exception:
                parsed = {"process": msg, "inputs": "", "output_text": "", "ldf_analysis": "", "tail_factor_selection": "", "impact": ""}

        parsed["environment_sensitivity"] = env_sensitivity
        parsed["output_numbers"] = {"Total IBNR": round(model.get_total_ibnr(), 0), "Total Ultimate": round(model.get_total_ultimate(), 0)}
        parsed["loss_ratios"] = loss_ratios
        parsed["suggested_elr"] = elr_suggestion

        final_msg = json.dumps(parsed)
        session['report'] = final_msg

        # ── Store results ─────────────────────────────────────────────────────
        cdfs_curve = t_eval.compute_cdfs(req.custom_ldfs)
        session['results'] = model.get_results()
        session['total_ultimate'] = model.get_total_ultimate()
        session['total_ibnr'] = model.get_total_ibnr()
        session['volatility'] = getattr(model, 'volatility', None)
        session['cdfs']      = cdfs_curve
        session['ldfs']      = req.custom_ldfs
        session['dev_ages']  = t_eval.dev_ages
        session['totalIBNR'] = model.get_total_ibnr()
        session['totalUlt']  = model.get_total_ultimate()
        
        # Store diagnostics for Analysis Agent
        session['loss_ratios'] = loss_ratios
        session['suggested_elr'] = elr_suggestion
        session['ldf_stability'] = ldf_stability
        session['volatility'] = getattr(model, 'volatility', 0)
        session['ratio_triangles'] = getattr(model, 'ratio_triangles', None) # If available
        session['curve_fitting_results'] = getattr(model, 'curve_fitting_results', None) # If available

        return {
            "success":   True,
            "results":   session['results'],
            "totalIBNR": session['totalIBNR'],
            "totalUlt":  session['totalUlt'],
            "totalPaid": total_paid,
            "narration": final_msg,
            "cdfs":      cdfs_curve,
            "ldfs":      req.custom_ldfs,
            "dev_ages":  t_eval.dev_ages,
            "loss_ratios":   loss_ratios,
            "suggested_elr": elr_suggestion,
            "ldf_stability": ldf_stability,
            "volatility":    session.get('volatility', 0)
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if session:
            if req.api_key: session['api_key'] = req.api_key
            if req.base_url: session['base_url'] = req.base_url
            if req.model_name: session['model_name'] = req.model_name
            
        reply = agent_workflow.run_parallel_chat(req.session_id, req.message, req.history)
        
        return {"success": True, "reply": reply}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/execute_all")
async def execute_all_models(req: ExecuteRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session: return {"success": False, "error": "Invalid session_id"}
        
        from models.methods import METHODS
        import copy
        t_eval = copy.deepcopy(session['triangle'])
        
        if req.rate_changes and t_eval.premiums:
            try:
                import pandas as pd
                from models.on_level import OnLevelPremiumCalculator
                prem_data = [{"accident_year": int(ay), "earned_premium": float(p)} for ay, p in t_eval.premiums.items()]
                calc = OnLevelPremiumCalculator(pd.DataFrame(prem_data), pd.DataFrame(req.rate_changes))
                on_level_df = calc.calculate()
                t_eval.premiums = dict(zip(on_level_df["accident_year"], on_level_df["on_level_premium"]))
            except:
                pass

        results = []
        for code, MethodClass in METHODS.items():
            if MethodClass.needs_premium and not t_eval.premiums:
                results.append({"code": code, "name": MethodClass.label, "ibnr": None, "ultimate": None, "error": "Requires Premium"})
                continue
                
            model = MethodClass()
            try:
                model.fit(t_eval, req.params, req.custom_ldfs)
                results.append({
                    "code": code,
                    "name": MethodClass.label,
                    "ibnr": round(model.get_total_ibnr(), 0),
                    "ultimate": round(model.get_total_ultimate(), 0),
                    "error": None
                })
            except Exception as e:
                results.append({"code": code, "name": MethodClass.label, "ibnr": None, "ultimate": None, "error": str(e)})
                
        return {"success": True, "results": results}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/export/{session_id}")
async def export_data(session_id: str):
    try:
        session = agent_workflow.SESSION_STORE.get(session_id)
        if not session: return JSONResponse(status_code=404, content={"error": "Session not found"})
        
        triangle = session.get('triangle')
        if not triangle: return JSONResponse(status_code=400, content={"error": "No triangle data"})
        
        export_obj = {
            "currency": "USD",
            "valuation_year": triangle.valuation_year,
            "accident_years": triangle.accident_years,
            "development_ages": triangle.dev_ages,
            "gross_paid_matrix": triangle.matrix,
            "gross_incurred_matrix": triangle.incurred_matrix,
            "gross_outstanding_matrix": triangle.outstanding_matrix if hasattr(triangle, 'outstanding_matrix') else None,
            "closed_claim_counts": triangle.closed_counts_matrix if hasattr(triangle, 'closed_counts_matrix') else None,
            "reported_claim_counts": triangle.reported_counts_matrix if hasattr(triangle, 'reported_counts_matrix') else None,
            "earned_premiums": triangle.premiums,
            "exposures": triangle.exposures,
            "selected_ldfs": session.get('ldfs'),
            "total_ibnr_selected": session.get('totalIBNR'),
            "total_ultimate_selected": session.get('totalUlt')
        }
        
        return JSONResponse(content=export_obj)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# Native HTML Hosting
import os
from fastapi.staticfiles import StaticFiles
dashboard_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "out"))
os.makedirs(dashboard_path, exist_ok=True)
app.mount("/", StaticFiles(directory=dashboard_path, html=True), name="dashboard")
