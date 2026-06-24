export interface ChatMessage {
  role: 'system' | 'user' | 'model' | 'agent' | 'action' | 'error' | 'warn';
  text: string;
  state?: 'analyzing' | '';
  id: string;
}

export interface SummaryData {
  accidentYears: number;
  devPeriods: number;
  oldestAY: number | null;
  latestAY: number | null;
  maxDevAge: number;
  totalPaid: number;
  completeness: number;
  isNewLOB: boolean;
  isLongTail: boolean;
  hasPremium: boolean;
  hasExposure: boolean;
  hasCounts: boolean;
  format: 'wide' | 'long';
  dataType: 'paid' | 'incurred';
  parseLog: string[];
  original_columns?: string[];
  entities?: string[];
  selected_entities?: string[] | null;
  classification?: {
    data_type: string;
    confidence: string;
    is_cas_format: boolean;
  };
  inspection?: {
    is_multi_entity: boolean;
    entity_column: string | null;
    entity_count: number;
    reserving_roles: Record<string, string | null>;
    accumulation_states: Record<string, string | null>;
  };
}

export interface LDFItem {
  fromAge: number;
  toAge: number | string;
  volumeWeighted: number | null;
  straightAvg: number | null;
  weighted3yr: number | null;
  weighted5yr: number | null;
  std: number;
  cov: number;
  n: number;
  isTail: boolean;
}

export interface TriangleData {
  accidentYears: number[];
  devAges: number[];
  matrix: (number | null)[][];
  incurred_matrix: (number | null)[][];
  ldfs: LDFItem[];
  incurred_ldfs?: LDFItem[];
  hasPremium: boolean;
  suggested_elr_paid?: number | null;
  suggested_elr_incurred?: number | null;
  suggested_mature_years?: number[];
  mature_reasoning?: Record<number, string>;
  method_availability?: Record<string, { available: boolean; reason: string | null }>;
}

export interface ModelParam {
  key: string;
  label: string;
  default: any;
}

export interface RankedModel {
  code: string;
  label: string;
  desc: string;
  score: number;
  recommended: boolean;
  params: ModelParam[];
}

export interface MethodConfig {
  enabled: boolean;
  runPaid?: boolean;
  runIncurred?: boolean;
  source?: 'paid' | 'incurred' | 'both';
  aprioriLossRatio?: number | null;
  iterations?: number;
  decay?: number;
  matureYears?: number[];
  curveType?: 'weibull' | 'loglogistic';
}

export type ExecutionConfig = Record<string, MethodConfig>;

export interface MethodResultItem {
  result_id: string;
  method: string;
  source: string;
  ultimate: number;
  ibnr: number;
  status: 'success' | 'warning' | 'error' | 'disabled' | 'failed' | 'incompatible';
  reason?: string | null;
  assumptions: {
    aprioriLossRatio?: number | null;
    iterations?: number;
    decay?: number;
    matureYears?: number[];
    curveType?: string;
    ldf_basis?: string;
    tail_factor?: number;
    [key: string]: any;
  };
  results: Record<string, any>[];
  error?: string | null;

  // Backward compatibility fields
  code?: string;
  name?: string;
  loss_ratio?: number;
  cv?: number;
  reserve_to_case_ratio?: number;
  maturity_score?: number;
  diff_from_median?: number;
}

export interface AIRecommendation {
  recommended_method: string;
  confidence: 'High' | 'Medium' | 'Low';
  reasoning: string[];
}

export interface ExecuteResult {
  success: boolean;
  run_id?: string;
  timestamp?: string;
  selected_methods?: string[];
  paid_ldfs?: number[];
  incurred_ldfs?: number[];
  paid_tail_factor?: number;
  incurred_tail_factor?: number;
  configs?: ExecutionConfig;
  summary: {
    best_estimate: number;
    selected_method: string;
  };
  ai_recommendation: AIRecommendation;
  methods: MethodResultItem[];
  loss_ratios?: {
    accident_year: number;
    premium: number;
    paid_lr_pct: number | null;
    ultimate_lr_pct: number | null;
  }[];
  suggested_elr?: number;
  ldf_stability?: {
    from_age: number;
    to_age: number;
    n: number;
    vw: number | null;
    cov_pct: number | null;
    stability: string;
    credibility: string;
  }[];
  olf_results?: {
    accident_year: number;
    earned_premium: number;
    average_rate_level: number;
    olf: number;
    on_level_premium: number;
  }[];
  volatility?: number;
  error?: string;
}

