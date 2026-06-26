from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import json
from typing import Dict, Any, Optional, List, Literal

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
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:3000", 
        "https://reserving-using-agentic-ai.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MethodConfig(BaseModel):
    enabled: bool
    run_paid: Optional[bool] = True
    run_incurred: Optional[bool] = True
    source: Optional[Literal["paid", "incurred", "both"]] = None
    aprioriLossRatio: Optional[float] = None
    iterations: Optional[int] = None
    decay: Optional[float] = None
    matureYears: Optional[List[int]] = None
    curveType: Optional[str] = None

class ExecuteRequest(BaseModel):
    session_id: str
    configs: Optional[Dict[str, MethodConfig]] = None
    paid_ldfs: Optional[List[float]] = None
    incurred_ldfs: Optional[List[float]] = None
    paid_tail_factor: Optional[float] = 1.0
    incurred_tail_factor: Optional[float] = 1.0
    mature_cdf_threshold: Optional[float] = 1.05
    
    # Backward compatibility fields
    method_code: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    custom_ldfs: Optional[list] = None
    custom_incurred_ldfs: Optional[list] = None
    data_source: Optional[str] = "paid"
    
    rate_changes: Optional[list] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None

class SingleModelReportRequest(BaseModel):
    session_id: str
    method_code: str

class ChatRequest(BaseModel):
    session_id: str
    user_text: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None

class OverrideRequest(BaseModel):
    session_id: str
    category: str
    rule: str
    rationale: str

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

class RecalculateSuggestionsRequest(BaseModel):
    session_id: str
    mature_cdf_threshold: float

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
            from models.tools import compute_suggested_elr, compute_mature_accident_years, compute_method_availability
            mature_info = compute_mature_accident_years(triangle)
            triangle_data = {
                "accidentYears": triangle.accident_years,
                "devAges": triangle.dev_ages,
                "matrix": triangle.matrix,
                "incurred_matrix": triangle.incurred_matrix,
                "ldfs": session.get('ldfs'),
                "incurred_ldfs": session.get('incurred_ldfs'),
                "hasPremium": bool(triangle.premiums),
                "suggested_elr_paid": compute_suggested_elr(triangle, "paid"),
                "suggested_elr_incurred": compute_suggested_elr(triangle, "incurred"),
                "suggested_mature_years": mature_info.get("mature_years", []),
                "mature_reasoning": mature_info.get("reasoning", {}),
                "method_availability": compute_method_availability(triangle)
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

        # Determine LDFs and matrix based on Selected Data Source
        data_source = req.data_source or "paid"
        ldfs_to_use = req.custom_ldfs
        
        if data_source == "incurred":
            t_eval.matrix = t_eval.incurred_matrix
            t_eval.data_type = "incurred"
            if req.custom_incurred_ldfs:
                ldfs_to_use = req.custom_incurred_ldfs

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
        tail_result = compute_tail_factor(ldfs_to_use, t_eval)
        chosen_tail   = tail_result["chosen"]
        chosen_reason = tail_result["reason"]
        if ldfs_to_use[-1] == 1.0:
            ldfs_to_use[-1] = chosen_tail
        else:
            chosen_reason = f"User Manual Override ({ldfs_to_use[-1]})"

        # ── Run Model ─────────────────────────────────────────────────────────
        model = MethodClass()
        model.fit(t_eval, req.params, ldfs_to_use)

        diag       = t_eval.get_latest_diagonal()
        total_paid = sum(v for v in diag if v is not None)

        # ── TOOL: IBNR Table (deterministic) ──────────────────────────────────
        ibnr_table = compute_ibnr_table(t_eval, model, ldfs_to_use)

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

        # ── Deterministic Report Generation (No Tokens Used) ──────────────────
        inputs_txt = f"Data used: {len(t_eval.accident_years)} accident years, evaluated to {max(t_eval.dev_ages)} months."
        if session['triangle'].premiums:
            inputs_txt += " Premium data was included."
            
        process_txt = PROCESS_EXPLANATIONS.get(req.method_code, "")
        if olf_note:
            process_txt += f" {olf_note}"
            
        output_txt = f"The model projected a Total IBNR of {round(model.get_total_ibnr(), 0):,.0f} and a Total Ultimate of {round(model.get_total_ultimate(), 0):,.0f}."
        
        ldf_txt = "LDFs were mathematically computed. "
        if ldf_stability:
            ldf_txt += f"Overall stability is based on {len(ldf_stability)} development periods. "
            
        impact_txt = "Premium and exposure changes directly scale the A Priori ELR and Expected Ultimates in this model." if session['triangle'].premiums else "No premium or exposure data used in this model."
        if req.method_code in ['CL', 'MCL', 'CO', 'CLK']:
            impact_txt = "This method relies purely on historical development patterns, meaning premium/exposure changes do not impact the projection."

        parsed = {
            "inputs": inputs_txt,
            "process": process_txt,
            "output_text": output_txt,
            "ldf_analysis": ldf_txt,
            "tail_factor_selection": f"Selected tail factor: {chosen_reason}.",
            "impact": impact_txt
        }

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

        # ── TOOL: Compliance Engine (ASOP) ────────────────────────────────────
        ce = session['compliance_engine']
        ce.run_estimation_checks(list(session['methods_executed']))
        ce.run_selection_checks()
        ce.run_results_checks()
        compliance_audit = ce.audit_log

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
            "volatility":    session.get('volatility', 0),
            "compliance_audit": compliance_audit
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

@app.post("/api/override_compliance")
async def override_compliance(req: OverrideRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session or 'compliance_engine' not in session:
            return {"success": False, "error": "Invalid session or compliance engine not found"}
        
        ce = session['compliance_engine']
        found = False
        for r in ce.audit_log.get(req.category, []):
            if r['rule'] == req.rule:
                r['status'] = "OVERRIDDEN_DOCUMENTED"
                r['details'] = f"Override Rationale: {req.rationale} | Original: {r['details']}"
                found = True
                break
        
        if not found:
            return {"success": False, "error": "Rule not found in specified category"}
            
        return {"success": True, "compliance_audit": ce.audit_log}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/generate_model_report")
async def generate_model_report(req: SingleModelReportRequest):
    try:
        report = agent_workflow.generate_single_model_report(req.session_id, req.method_code)
        if report.startswith("Error:") or report.startswith("Failed to generate"):
            return {"success": False, "error": report}
        return {"success": True, "report": report}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/execute_all")
async def execute_all_models(req: ExecuteRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session: return {"success": False, "error": "Invalid session_id"}
        
        from models.methods import METHODS
        from models.tools import compute_suggested_elr, compute_tail_factor
        import copy
        import concurrent.futures
        import numpy as np
        import uuid
        import datetime

        # Prepare base triangle copy
        t_eval_base = copy.deepcopy(session['triangle'])
        
        # Determine configs
        configs = req.configs
        if not configs:
            configs = {}
            for code, MethodClass in METHODS.items():
                run_p = True
                run_i = True
                if MethodClass.requires_paid_triangle and not MethodClass.requires_incurred_triangle:
                    run_i = False
                elif MethodClass.requires_incurred_triangle and not MethodClass.requires_paid_triangle:
                    run_p = False
                configs[code] = MethodConfig(
                    enabled=True,
                    run_paid=run_p,
                    run_incurred=run_i
                )

        paid_ldfs_to_use = req.paid_ldfs if req.paid_ldfs is not None else (req.custom_ldfs if req.custom_ldfs is not None else [])
        incurred_ldfs_to_use = req.incurred_ldfs if req.incurred_ldfs is not None else (req.custom_incurred_ldfs if req.custom_incurred_ldfs is not None else [])

        # Fallback to calculated LDFs from session if empty
        if not paid_ldfs_to_use and session.get('ldfs'):
            paid_ldfs_to_use = session.get('ldfs')
        if not incurred_ldfs_to_use and session.get('incurred_ldfs'):
            incurred_ldfs_to_use = session.get('incurred_ldfs')

        # Precompute suggested ELRs once to avoid redundant execution in thread pool
        mature_thresh = req.mature_cdf_threshold if req.mature_cdf_threshold is not None else 1.05
        suggested_elr_paid = compute_suggested_elr(t_eval_base, "paid", mature_thresh) or 65.0
        suggested_elr_incurred = compute_suggested_elr(t_eval_base, "incurred", mature_thresh) or 65.0

        # Define single method execution runner for a specific source
        def run_method_for_source(code, MethodClass, source_val):
            try:
                # determine result_id, source_label, name_label
                if source_val == "both":
                    result_id = code
                    source_label = "Paid + Incurred"
                    name_label = MethodClass.label
                else:
                    result_id = f"{code}_{source_val.upper()}"
                    source_label = source_val.capitalize()
                    name_label = f"{MethodClass.label} ({source_label})"

                method_config = configs.get(code)
                if not method_config:
                    return {
                        "result_id": result_id,
                        "method": MethodClass.label,
                        "source": source_label,
                        "status": "disabled",
                        "reason": "Method not configured",
                        "assumptions": {},
                        "results": [],
                        "error": None,
                        "code": result_id,
                        "name": name_label,
                        "ultimate": 0.0,
                        "ibnr": 0.0
                    }
                
                # Check availability (premium-dependent methods)
                if MethodClass.needs_premium and not t_eval_base.premiums:
                    return {
                        "result_id": result_id,
                        "method": MethodClass.label,
                        "source": source_label,
                        "status": "disabled",
                        "reason": "Missing Earned Premium",
                        "assumptions": {},
                        "results": [],
                        "error": "Method requires Premium data, which is missing.",
                        "code": result_id,
                        "name": name_label,
                        "ultimate": 0.0,
                        "ibnr": 0.0
                    }

                model = MethodClass()
                t_eval = copy.deepcopy(t_eval_base)

                # Determine explicit matrix and LDFs based on source
                if source_val == "incurred":
                    matrix_to_use = t_eval_base.incurred_matrix
                    ldfs_for_run = copy.deepcopy(incurred_ldfs_to_use)
                    tail_to_use = req.incurred_tail_factor
                    ldf_basis_name = "incurred"
                elif source_val == "paid":
                    matrix_to_use = t_eval_base.matrix
                    ldfs_for_run = copy.deepcopy(paid_ldfs_to_use)
                    tail_to_use = req.paid_tail_factor
                    ldf_basis_name = "paid"
                else: # both (requires both paid and incurred)
                    matrix_to_use = t_eval_base.matrix
                    ldfs_for_run = copy.deepcopy(paid_ldfs_to_use)
                    tail_to_use = req.paid_tail_factor
                    ldf_basis_name = "both"

                # Apply tail factor if last factor is 1.0 (or default tail factor)
                if ldfs_for_run and ldfs_for_run[-1] == 1.0:
                    ldfs_for_run[-1] = tail_to_use

                # Derive defaults or use config parameters
                suggested_elr_pct = suggested_elr_incurred if source_val == "incurred" else suggested_elr_paid
                
                params = {}
                assumptions = {
                    "source": source_label,
                    "ldf_basis": ldf_basis_name,
                    "tail_factor": float(tail_to_use)
                }

                if code == 'BF':
                    val = method_config.aprioriLossRatio if method_config.aprioriLossRatio is not None else suggested_elr_pct
                    params['aprioriLossRatio'] = val
                    assumptions['aprioriLossRatio'] = float(val) / 100.0
                elif code == 'BK':
                    val = method_config.aprioriLossRatio if method_config.aprioriLossRatio is not None else suggested_elr_pct
                    params['aprioriLossRatio'] = val
                    params['iterations'] = method_config.iterations if method_config.iterations is not None else 2
                    assumptions['aprioriLossRatio'] = float(val) / 100.0
                    assumptions['iterations'] = int(params['iterations'])
                elif code == 'CC':
                    params['decay'] = method_config.decay if method_config.decay is not None else 0.9
                    assumptions['decay'] = float(params['decay'])
                elif code == 'ELR':
                    if method_config.matureYears:
                        params['matureYears'] = method_config.matureYears
                        assumptions['matureYears'] = method_config.matureYears
                    else:
                        m_info = compute_mature_accident_years(t_eval_base, mature_thresh)
                        params['matureYears'] = m_info["mature_years"]
                        assumptions['matureYears'] = m_info["mature_years"]
                    params['lrCap'] = 5.0
                    assumptions['lrCap'] = 5.0
                elif code == 'CLK':
                    params['curveType'] = method_config.curveType if method_config.curveType is not None else 'weibull'
                    assumptions['curveType'] = params['curveType']

                # FIT model using EXPLICIT matrix argument (zero triangle.matrix swap/mutation!)
                model.fit(t_eval, params, ldfs_for_run, matrix=matrix_to_use)
                
                results = model.get_results()
                total_ibnr = model.get_total_ibnr()
                total_ultimate = model.get_total_ultimate()
                
                # Calculate metrics:
                # 1. Loss Ratio
                total_premium = sum(t_eval.premiums.values()) if t_eval.premiums else 0
                loss_ratio = total_ultimate / total_premium if total_premium > 0 else 0.0
                
                # 2. Maturity Score
                cdfs = model.cdfs
                dev_idx = [next((idx for idx, v in reversed(list(enumerate(row))) if v is not None and not np.isnan(v)), 0) for row in matrix_to_use]
                maturity_scores = []
                for idx in dev_idx:
                    cdf = cdfs[idx] if idx < len(cdfs) else 1.0
                    maturity_scores.append(1.0 / cdf if cdf > 0 else 1.0)
                maturity_score = sum(maturity_scores) / len(maturity_scores) if maturity_scores else 0.0
                
                # 3. Reserve-to-Case Ratio
                tot_inc = 0
                tot_paid = 0
                for i in range(len(t_eval.accident_years)):
                    inc_row = t_eval.incurred_matrix[i] if t_eval.incurred_matrix else []
                    paid_row = t_eval.matrix[i]
                    last_inc = next((v for v in reversed(inc_row) if v is not None and not np.isnan(v)), None)
                    last_paid = next((v for v in reversed(paid_row) if v is not None and not np.isnan(v)), None)
                    if last_inc is not None: tot_inc += last_inc
                    if last_paid is not None: tot_paid += last_paid
                case_outstanding = tot_inc - tot_paid
                reserve_to_case_ratio = total_ibnr / case_outstanding if case_outstanding > 0 else 0.0
                
                # 4. CV
                cv = 0.0
                if code == 'MCL' and hasattr(model, 'volatility') and total_ibnr > 0:
                    cv = getattr(model, 'volatility', 0.0) / total_ibnr
                elif code == 'CLK' and hasattr(model, 'volatility') and total_ibnr > 0:
                    cv = getattr(model, 'volatility', 0.0) / total_ibnr
                    
                return {
                    "result_id": result_id,
                    "method": MethodClass.label,
                    "source": source_label,
                    "ultimate": float(total_ultimate),
                    "ibnr": float(total_ibnr),
                    "status": "success",
                    "reason": None,
                    "assumptions": assumptions,
                    "results": results,
                    "error": None,
                    
                    # Backward compatibility fields
                    "code": result_id,
                    "name": name_label,
                    "loss_ratio": float(loss_ratio),
                    "cv": float(cv),
                    "reserve_to_case_ratio": float(reserve_to_case_ratio),
                    "maturity_score": float(maturity_score)
                }
            except Exception as e:
                if source_val == "both":
                    result_id = code
                    source_label = "Paid + Incurred"
                    name_label = MethodClass.label
                else:
                    result_id = f"{code}_{source_val.upper()}"
                    source_label = source_val.capitalize()
                    name_label = f"{MethodClass.label} ({source_label})"
                return {
                    "result_id": result_id,
                    "method": MethodClass.label,
                    "source": source_label,
                    "status": "error",
                    "reason": str(e),
                    "assumptions": {},
                    "results": [],
                    "error": str(e),
                    "code": result_id,
                    "name": name_label,
                    "ultimate": 0.0,
                    "ibnr": 0.0
                }

        # Build execution tasks list
        tasks_to_run = []
        for code, MethodClass in METHODS.items():
            method_config = configs.get(code)
            if not method_config:
                continue
                
            if not method_config.enabled:
                if MethodClass.supports_source_selection:
                    if method_config.run_paid:
                        tasks_to_run.append((code, MethodClass, "paid", True))
                    if method_config.run_incurred:
                        tasks_to_run.append((code, MethodClass, "incurred", True))
                    if not method_config.run_paid and not method_config.run_incurred:
                        tasks_to_run.append((code, MethodClass, "paid", True))
                else:
                    tasks_to_run.append((code, MethodClass, "both", True))
                continue
                
            if MethodClass.supports_source_selection:
                if method_config.run_paid:
                    tasks_to_run.append((code, MethodClass, "paid", False))
                if method_config.run_incurred:
                    tasks_to_run.append((code, MethodClass, "incurred", False))
            else:
                tasks_to_run.append((code, MethodClass, "both", False))

        # Run concurrent executions
        methods_out = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = {}
            for code, MethodClass, source_val, is_disabled in tasks_to_run:
                # result_id and labeling for disabled runs
                if source_val == "both":
                    result_id = code
                    source_label = "Paid + Incurred"
                    name_label = MethodClass.label
                else:
                    result_id = f"{code}_{source_val.upper()}"
                    source_label = source_val.capitalize()
                    name_label = f"{MethodClass.label} ({source_label})"

                if is_disabled:
                    methods_out.append({
                        "result_id": result_id,
                        "method": MethodClass.label,
                        "source": source_label,
                        "status": "disabled",
                        "reason": "Disabled by user",
                        "assumptions": {},
                        "results": [],
                        "error": None,
                        "code": result_id,
                        "name": name_label,
                        "ultimate": 0.0,
                        "ibnr": 0.0
                    })
                else:
                    futures[executor.submit(run_method_for_source, code, MethodClass, source_val)] = (code, source_val)
                    
            for future in concurrent.futures.as_completed(futures):
                methods_out.append(future.result())

        # Difference from Median Ultimate (excluding unsuccessful / disabled runs)
        successful_runs = [m for m in methods_out if m["status"] == "success"]
        successful_ultimates = [m["ultimate"] for m in successful_runs]
        if successful_ultimates:
            median_ultimate = float(np.median(successful_ultimates))
            for m in methods_out:
                if m["status"] == "success":
                    m["diff_from_median"] = (m["ultimate"] - median_ultimate) / median_ultimate if median_ultimate > 0 else 0.0
                else:
                    m["diff_from_median"] = 0.0
        else:
            median_ultimate = 0.0
            for m in methods_out:
                m["diff_from_median"] = 0.0

        methods_out.sort(key=lambda x: x["result_id"])

        # Reserve Recommendation Agent
        results_summary_for_ai = [
            {
                "code": m["code"],
                "name": m["name"],
                "status": m["status"],
                "ibnr": m.get("ibnr", 0.0),
                "ultimate": m.get("ultimate", 0.0),
                "loss_ratio": m.get("loss_ratio", 0.0),
                "maturity_score": m.get("maturity_score", 0.0),
                "reserve_to_case_ratio": m.get("reserve_to_case_ratio", 0.0)
            } for m in methods_out if m["status"] == "success"
        ]
        
        session['api_key'] = req.api_key or session.get('api_key')
        session['base_url'] = req.base_url or session.get('base_url')
        session['model_name'] = req.model_name or session.get('model_name')
        
        ai_recommendation = agent_workflow.run_reserve_recommendation_agent(req.session_id, results_summary_for_ai)
        
        rec_code = ai_recommendation.get("recommended_method", "CL")
        rec_model = next((m for m in methods_out if m["code"] == rec_code and m["status"] == "success"), None)
        best_estimate_val = rec_model["ultimate"] if rec_model else (median_ultimate if median_ultimate > 0 else 0.0)
        
        run_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        selected_methods = [code for code, cfg in configs.items() if cfg.enabled]

        # ── TOOL: Compliance Engine (ASOP) ────────────────────────────────────
        compliance_audit = {}
        if 'compliance_engine' in session:
            ce = session['compliance_engine']
            executed = [m["code"] for m in methods_out if m["status"] == "success"]
            ce.run_estimation_checks(executed)
            ce.run_selection_checks()
            ce.run_results_checks()
            compliance_audit = ce.audit_log

        session['results'] = {
            "run_id": run_id,
            "timestamp": timestamp,
            "selected_methods": selected_methods,
            "paid_ldfs": paid_ldfs_to_use,
            "incurred_ldfs": incurred_ldfs_to_use,
            "paid_tail_factor": req.paid_tail_factor,
            "incurred_tail_factor": req.incurred_tail_factor,
            "configs": {k: v.dict() for k, v in configs.items()},
            "best_estimate": best_estimate_val,
            "selected_method": rec_code,
            "ai_recommendation": ai_recommendation,
            "methods": methods_out
        }
        
        return {
            "success": True,
            "run_id": run_id,
            "timestamp": timestamp,
            "selected_methods": selected_methods,
            "paid_ldfs": paid_ldfs_to_use,
            "incurred_ldfs": incurred_ldfs_to_use,
            "paid_tail_factor": req.paid_tail_factor,
            "incurred_tail_factor": req.incurred_tail_factor,
            "configs": configs,
            "summary": {
                "best_estimate": best_estimate_val,
                "selected_method": rec_code
            },
            "ai_recommendation": ai_recommendation,
            "methods": methods_out,
            "compliance_audit": compliance_audit
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/recalculate_suggestions")
async def recalculate_suggestions(req: RecalculateSuggestionsRequest):
    try:
        session = agent_workflow.SESSION_STORE.get(req.session_id)
        if not session:
            return {"success": False, "error": "Session not found"}
        triangle = session.get('triangle')
        if not triangle:
            return {"success": False, "error": "Triangle not found"}
        from models.tools import compute_suggested_elr, compute_mature_accident_years
        mature_info = compute_mature_accident_years(triangle, req.mature_cdf_threshold)
        return {
            "success": True,
            "suggested_elr_paid": compute_suggested_elr(triangle, "paid", req.mature_cdf_threshold),
            "suggested_elr_incurred": compute_suggested_elr(triangle, "incurred", req.mature_cdf_threshold),
            "suggested_mature_years": mature_info.get("mature_years", []),
            "mature_reasoning": mature_info.get("reasoning", {})
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/export/{session_id}")
async def export_data(session_id: str):
    try:
        session = agent_workflow.SESSION_STORE.get(session_id)
        if not session: return JSONResponse(status_code=404, content={"error": "Session not found"})
        
        triangle = session.get('triangle')
        if not triangle: return JSONResponse(status_code=400, content={"error": "No triangle data"})
        
        try:
            from models.diagnostics import compute_diagnostics
            diag_metrics = compute_diagnostics(triangle)
        except Exception:
            diag_metrics = {}

        export_obj = {
            "currency": "USD",
            "valuation_year": triangle.valuation_year,
            "accident_years": triangle.accident_years,
            "development_ages": triangle.dev_ages,
            "gross_paid_matrix": triangle.matrix,
            "gross_incurred_matrix": triangle.incurred_matrix,
            "gross_outstanding_matrix": getattr(triangle, 'outstanding_matrix', None),
            "closed_claim_counts": getattr(triangle, 'closed_counts_matrix', None),
            "reported_claim_counts": getattr(triangle, 'reported_counts_matrix', None),
            "earned_premiums": triangle.premiums,
            "exposures": triangle.exposures,
            "selected_ldfs": session.get('ldfs'),
            "total_ibnr_selected": session.get('totalIBNR'),
            "total_ultimate_selected": session.get('totalUlt'),
            "diagnostics": diag_metrics
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
