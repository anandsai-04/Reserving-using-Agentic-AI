import pandas as pd
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Any
from enum import Enum
import re


class SemanticType(str, Enum):
    IDENTIFIER = "identifier"
    CATEGORY = "category"
    NUMERIC_MEASURE = "numeric_measure"
    TIME_INDEX = "time_index"
    BOOLEAN = "boolean"


@dataclass
class ColumnProfile:
    name: str
    dtype: str  # pandas dtype as string, e.g. "int64", "object"
    null_count: int
    null_percentage: float
    unique_count: int
    sample_values: list  # a few example values, for human review
    semantic_type: SemanticType
    category_counts: dict  # populated only for CATEGORY, BOOLEAN, and IDENTIFIER types


@dataclass
class EntityCheckResult:
    is_multi_entity: bool
    entity_column: Optional[str]  # which column identifies separate entities, if found
    entity_count: int  # how many distinct entities, 0 if not multi-entity
    reasons: list[str]


@dataclass
class InspectionResult:
    columns: list[ColumnProfile]
    entity_check: EntityCheckResult
    row_count: int
    column_count: int
    warnings: list[str] = field(default_factory=list)
    reserving_roles: dict[str, Optional[str]] = field(default_factory=dict)
    accumulation_states: dict[str, Optional[str]] = field(default_factory=dict)


class DataInspector:
    """
    Examines a DataFrame's columns in detail: types, nulls, uniqueness,
    categorical breakdowns, and multi-entity structure.
    Can receive an already-loaded DataFrame, or load one independently from a file path.
    """

    IDENTIFIER_NAME_HINTS = ["id", "code", "grcode", "company", "entity"]
    TIME_NAME_HINTS = [
        "year",
        "month",
        "quarter",
        "lag",
        "development",
        "accident",
        "calendar",
        "date"
    ]

    def __init__(
        self, df: Optional[pd.DataFrame] = None, file_path: Optional[str] = None, data_type: Optional[str] = None
    ):
        self.data_type = data_type
        self.file_path = Path(file_path) if file_path is not None else None
        if df is not None:
            self.df = df
        elif file_path is not None:
            self.df = self._load_file(self.file_path)
        else:
            raise ValueError(
                "DataInspector requires either a DataFrame or a file_path to be provided."
            )

    def _load_file(self, path: Path) -> pd.DataFrame:
        """
        Loads a file independently, for standalone use without classifier.py.
        """
        suffix = path.suffix.lower()
        if suffix == ".csv":
            return pd.read_csv(path)
        elif suffix in [".xlsx", ".xls"]:
            return pd.read_excel(path)
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

    def _classify_semantic_type(
        self, column_name: str, series: pd.Series, unique_count: int, row_count: int
    ) -> SemanticType:
        """
        Determines the semantic role of a column, not just its raw pandas dtype.
        Order matters: checks run from most-specific to least-specific.
        """
        # name_lower = column_name.lower()
        is_numeric_dtype = pd.api.types.is_numeric_dtype(series)

        # Step 1: Identifiers -- name hint is primary signal
        name_words = self._split_into_words(column_name)
        if any(hint in name_words for hint in self.IDENTIFIER_NAME_HINTS):
            return SemanticType.IDENTIFIER
        # Fallback identifier signal: near-unique string columns (not numeric measures)
        if not is_numeric_dtype and row_count > 0 and (unique_count / row_count) > 0.8:
            return SemanticType.IDENTIFIER

        # Step 2: Booleans
        if unique_count <= 2:
            return SemanticType.BOOLEAN

        # Step 3: Time index -- name hint based
        if any(hint in name_words for hint in self.TIME_NAME_HINTS):
            return SemanticType.TIME_INDEX

        # Step 4: Categories -- text/object dtype, or small numeric enumerations
        if pd.api.types.is_string_dtype(series) or isinstance(
            series.dtype, pd.CategoricalDtype
        ):
            return SemanticType.CATEGORY
        if is_numeric_dtype and unique_count <= 20:
            # Prevent financial/reserving metrics from being treated as categories
            exclude_hints = ["loss", "paid", "incurred", "premium", "reserve", "count", "value", "measure"]
            if not any(hint in column_name.lower() for hint in exclude_hints):
                return SemanticType.CATEGORY

        # Step 5: Default -- numeric measure
        return SemanticType.NUMERIC_MEASURE

    def _profile_column(self, column_name: str) -> ColumnProfile:
        series = self.df[column_name]
        row_count = len(series)

        null_count = int(series.isnull().sum())
        null_percentage = (
            round((null_count / row_count) * 100, 2) if row_count > 0 else 0.0
        )
        unique_count = int(series.nunique())
        sample_values = series.dropna().unique()[:5].tolist()

        semantic_type = self._classify_semantic_type(
            column_name, series, unique_count, row_count
        )

        category_counts = {}
        if semantic_type in (
            SemanticType.CATEGORY,
            SemanticType.BOOLEAN,
            SemanticType.IDENTIFIER,
        ):
            category_counts = series.value_counts().to_dict()

        return ColumnProfile(
            name=column_name,
            dtype=str(series.dtype),
            null_count=null_count,
            null_percentage=null_percentage,
            unique_count=unique_count,
            sample_values=sample_values,
            semantic_type=semantic_type,
            category_counts=category_counts,
        )

    def _profile_all_columns(self) -> list[ColumnProfile]:
        """
        Builds a ColumnProfile for every column in the DataFrame.
        """
        return [self._profile_column(col) for col in self.df.columns]

    def _split_into_words(self, column_name: str) -> list[str]:
        """
        Splits a column name into lowercase word tokens, handling
        snake_case, camelCase, and plain concatenation.
        e.g. "GRCODE" -> ["grcode"], "policy_id" -> ["policy", "id"],
            "AccidentYear" -> ["accident", "year"]
        """
        # Insert a space before capital letters that follow lowercase letters (camelCase split)
        spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", column_name)
        # Replace underscores with spaces too
        spaced = spaced.replace("_", " ")
        return spaced.lower().split()

    def _detect_entities(
        self, column_profiles: list[ColumnProfile]
    ) -> EntityCheckResult:
        """
        Examines IDENTIFIER-type columns to determine whether this file
        contains multiple stacked entities (e.g. companies), and if so,
        which column identifies them and how many distinct entities exist.
        """
        reasons = []
        identifier_profiles = [
            p for p in column_profiles if p.semantic_type == SemanticType.IDENTIFIER
        ]

        if not identifier_profiles:
            reasons.append(
                "No identifier-type columns found; cannot assess multi-entity structure."
            )
            return EntityCheckResult(
                is_multi_entity=False,
                entity_column=None,
                entity_count=0,
                reasons=reasons,
            )

        best_candidate = None
        best_uniformity_score = -1.0

        for profile in identifier_profiles:
            counts = list(profile.category_counts.values())
            if not counts:
                continue

            mean_count = sum(counts) / len(counts)
            max_deviation = max(abs(c - mean_count) for c in counts)
            uniformity_score = (
                1.0 - (max_deviation / mean_count) if mean_count > 0 else 0.0
            )

            reasons.append(
                f"'{profile.name}': {profile.unique_count} distinct values, "
                f"~{mean_count:.0f} rows each on average (uniformity: {uniformity_score:.2f})."
            )

            if uniformity_score > best_uniformity_score:
                best_uniformity_score = uniformity_score
                best_candidate = profile

        UNIFORMITY_THRESHOLD = 0.8

        if (
            best_candidate
            and best_candidate.unique_count > 1
            and best_uniformity_score >= UNIFORMITY_THRESHOLD
        ):
            reasons.append(
                f"'{best_candidate.name}' selected as the entity column: {best_candidate.unique_count} "
                f"entities with a consistent row pattern (uniformity {best_uniformity_score:.2f})."
            )

            # Cross-check: does any CATEGORY column with a similar unique count map 1-to-1
            # with the chosen entity column? Useful for spotting naming inconsistencies
            # (e.g. two entities sharing a display name) without treating it as an error.
            self._cross_check_entity_naming(best_candidate, column_profiles, reasons)

            return EntityCheckResult(
                is_multi_entity=True,
                entity_column=best_candidate.name,
                entity_count=best_candidate.unique_count,
                reasons=reasons,
            )

        reasons.append(
            "No identifier column showed a strong enough uniform repeating pattern to confirm multi-entity structure."
        )
        return EntityCheckResult(
            is_multi_entity=False,
            entity_column=None,
            entity_count=0,
            reasons=reasons,
        )

    def map_reserving_roles(self, profiles: list[ColumnProfile]) -> dict[str, Any]:
        """
        Scans the column profiles and maps them to specific reserving roles:
        - origin_col: The accident or origin year
        - dev_col: The development lag or period age
        - paid_col: Cumulative or incremental paid losses
        - incurred_col: Cumulative or incremental incurred losses
        - premium_col: Net/gross earned premiums
        - count_col: Claim counts
        """
        # Handle wide_triangle first
        if self.data_type == "wide_triangle":
            # 1. Origin column detection
            origin_candidates = ["accidentyear", "accident_year", "ay", "origin_year", "origin"]
            origin_col = None
            for profile in profiles:
                col_lower = profile.name.lower()
                if any(cand == col_lower or cand in col_lower for cand in origin_candidates):
                    origin_col = profile.name
                    break
            if not origin_col:
                # Fallback to the first non-numeric header column
                for profile in profiles:
                    name_str = str(profile.name).strip()
                    if not (name_str.isdigit() or re.match(r'^\d+(\.\d+)?$', name_str)):
                        origin_col = profile.name
                        break

            # 2. Development lag column detection (bare numeric columns)
            lag_cols = []
            for profile in profiles:
                name_str = str(profile.name).strip()
                if (name_str.isdigit() or re.match(r'^\d+(\.\d+)?$', name_str)) and profile.name != origin_col:
                    lag_cols.append(profile.name)
            
            # Sort lags numerically
            def try_float(val):
                try:
                    return float(val)
                except ValueError:
                    return 99999.0
            lag_cols = sorted(lag_cols, key=try_float)

            # 3. Determine which financial measure the values represent based on file name or columns
            filename = self.file_path.name if self.file_path else ""
            fn_lower = filename.lower()
            
            value_col = "paid_loss"
            role_key = "paid_col"
            
            if "incurred" in fn_lower or "incur" in fn_lower:
                value_col = "incurred_loss"
                role_key = "incurred_col"
            elif "premium" in fn_lower or "prem" in fn_lower:
                value_col = "premium"
                role_key = "premium_col"

            return {
                "origin_col": origin_col,
                "dev_col": lag_cols,  # List of numeric lag column names
                "paid_col": value_col if role_key == "paid_col" else None,
                "incurred_col": value_col if role_key == "incurred_col" else None,
                "premium_col": value_col if role_key == "premium_col" else None,
                "count_col": None
            }

        def get_best_column(keywords_high: list[str], keywords_low: list[str], allowed_types: list[SemanticType], exclude_keywords: list[str] = None) -> Optional[str]:
            best_col = None
            best_score = 0
            for profile in profiles:
                if profile.semantic_type not in allowed_types:
                    continue
                col_lower = profile.name.lower()
                col_clean = col_lower.replace("_", "").replace(" ", "")
                words = self._split_into_words(profile.name)
                
                # Check exclusion keywords
                if exclude_keywords:
                    if any(ekw in col_lower for ekw in exclude_keywords):
                        continue
                
                score = 0
                for kw in keywords_high:
                    kw_clean = kw.replace("_", "").replace(" ", "")
                    if kw in words or kw_clean == col_clean:
                        score += 10
                    elif kw in col_lower:
                        score += 5
                for kw in keywords_low:
                    kw_clean = kw.replace("_", "").replace(" ", "")
                    if kw in words or kw_clean == col_clean:
                        score += 3
                    elif kw in col_lower:
                        score += 1
                        
                if score > best_score:
                    best_score = score
                    best_col = profile.name
            return best_col

        roles = {
            "origin_col": get_best_column(
                keywords_high=["accidentyear", "accident", "ay", "origin", "underwriting", "uy"],
                keywords_low=["year", "period"],
                allowed_types=[SemanticType.TIME_INDEX]
            ),
            "dev_col": get_best_column(
                keywords_high=["lag", "age", "devyear", "dy", "dev_lag", "developmentlag"],
                keywords_low=["development", "dev", "year", "valuation"],
                allowed_types=[SemanticType.TIME_INDEX]
            ),
            "paid_col": get_best_column(
                keywords_high=["cumpaidloss", "cumpaid", "paidloss", "paid"],
                keywords_low=["loss"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["incur", "outstanding", "reserve"]
            ),
            "incurred_col": get_best_column(
                keywords_high=["incurredloss", "incurloss", "incurred", "incur"],
                keywords_low=["loss"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "outstanding"]
            ),
            "premium_col": get_best_column(
                keywords_high=["earnedpremnet", "netprem", "netearnedprem", "netpremium"],
                keywords_low=["premium", "prem", "earned", "dir", "ceded"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "incur", "loss", "reserve"]
            ),
            "count_col": get_best_column(
                keywords_high=["claimnb", "claimcount", "claimnumber", "numclaims", "claims", "claim_nb"],
                keywords_low=["count", "counts", "number"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "incur", "premium", "earned", "loss", "reserve", "closed", "reported"]
            ),
            "transaction_date_col": get_best_column(
                keywords_high=["transactiondate", "transdate", "t_date"],
                keywords_low=["transaction", "date"],
                allowed_types=[SemanticType.TIME_INDEX]
            ),
            "reporting_date_col": get_best_column(
                keywords_high=["reportingdate", "reportdate", "r_date"],
                keywords_low=["report", "date"],
                allowed_types=[SemanticType.TIME_INDEX]
            ),
            "transaction_type_col": get_best_column(
                keywords_high=["transactiontype", "transtype"],
                keywords_low=["type"],
                allowed_types=[SemanticType.CATEGORY]
            ),
            "transaction_amount_col": get_best_column(
                keywords_high=["transactionamount", "transamount"],
                keywords_low=["amount"],
                allowed_types=[SemanticType.NUMERIC_MEASURE]
            ),
            "outstanding_col": get_best_column(
                keywords_high=["caseoutstanding", "outstanding", "os", "reserve", "case"],
                keywords_low=["res"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "incur", "premium"]
            ),
            "closed_count_col": get_best_column(
                keywords_high=["closedcount", "closedclaims", "closed"],
                keywords_low=["count"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "incur", "premium", "reported"]
            ),
            "reported_count_col": get_best_column(
                keywords_high=["reportedcount", "reportedclaims", "reported"],
                keywords_low=["count"],
                allowed_types=[SemanticType.NUMERIC_MEASURE],
                exclude_keywords=["paid", "incur", "premium", "closed"]
            )
        }
        return roles

    def detect_accumulation_state(self, origin_col: str, dev_col: str, target_col: str) -> str:
        """
        Determines if a target column (e.g. loss or count) is "cumulative" or "incremental".
        Uses name heuristics first, then a monotonicity audit as fallback.
        """
        col_lower = target_col.lower()
        # Step 1: Name-based check
        if any(term in col_lower for term in ["cumulative", "cum", "cmp"]) or col_lower.endswith("_c") or "_c_" in col_lower:
            return "cumulative"
        if any(term in col_lower for term in ["incremental", "inc"]) or col_lower.endswith("_i") or "_i_" in col_lower:
            return "incremental"

        # Step 2: Mathematical Monotonicity Audit
        if origin_col not in self.df.columns or dev_col not in self.df.columns or target_col not in self.df.columns:
            return "cumulative"

        try:
            temp_df = self.df[[origin_col, dev_col, target_col]].dropna().copy()
            temp_df[target_col] = pd.to_numeric(temp_df[target_col])
        except Exception:
            return "cumulative"

        if temp_df.empty:
            return "cumulative"

        temp_df = temp_df.sort_values(by=[origin_col, dev_col])
        
        total_steps = 0
        monotonic_steps = 0
        
        for _, group in temp_df.groupby(origin_col):
            values = group[target_col].tolist()
            if len(values) < 2:
                continue
            for i in range(len(values) - 1):
                total_steps += 1
                if values[i + 1] >= values[i]:
                    monotonic_steps += 1
                    
        if total_steps == 0:
            return "cumulative"
            
        ratio = monotonic_steps / total_steps
        if ratio >= 0.90:
            return "cumulative"
        else:
            return "incremental"

    def inspect(self) -> InspectionResult:
        """
        Main entry point. Profiles every column and checks for multi-entity
        structure, returning a complete InspectionResult.
        """
        column_profiles = self._profile_all_columns()
        entity_check = self._detect_entities(column_profiles)

        warnings = []
        if entity_check.is_multi_entity:
            warnings.append(
                f"This file contains {entity_check.entity_count} distinct entities "
                f"(column: '{entity_check.entity_column}'). Downstream analysis "
                f"(e.g. triangle construction) should likely be performed per-entity, "
                f"not on the file as a whole."
            )

        # Map reserving roles
        reserving_roles = self.map_reserving_roles(column_profiles)

        # Audit accumulation states
        accumulation_states = {}
        origin_col = reserving_roles.get("origin_col")
        dev_col = reserving_roles.get("dev_col")

        if self.data_type == "wide_triangle":
            for role_key in ["paid_col", "incurred_col", "count_col", "premium_col"]:
                col_name = reserving_roles.get(role_key)
                if col_name:
                    accumulation_states[col_name] = "cumulative"
        else:
            for role_key in ["paid_col", "incurred_col", "count_col", "premium_col"]:
                col_name = reserving_roles.get(role_key)
                if col_name and col_name in self.df.columns:
                    if origin_col and dev_col and isinstance(dev_col, str):
                        accumulation_states[col_name] = self.detect_accumulation_state(
                            origin_col, dev_col, col_name
                        )
                    else:
                        # Fallback name check only if time columns are missing
                        col_lower = col_name.lower()
                        if any(term in col_lower for term in ["cumulative", "cum", "cmp"]):
                            accumulation_states[col_name] = "cumulative"
                        elif any(term in col_lower for term in ["incremental", "inc"]):
                            accumulation_states[col_name] = "incremental"
                        else:
                            accumulation_states[col_name] = "cumulative"

        return InspectionResult(
            columns=column_profiles,
            entity_check=entity_check,
            row_count=len(self.df),
            column_count=len(self.df.columns),
            warnings=warnings,
            reserving_roles=reserving_roles,
            accumulation_states=accumulation_states,
        )

    def melt_wide_triangle_to_long(self, df: pd.DataFrame, origin_col: str, dev_cols: list[str], value_col_name: str) -> pd.DataFrame:
        """
        Pivots/melts a wide-format triangle DataFrame into a long-format DataFrame.
        """
        # Melt the dataframe
        melted = df.melt(
            id_vars=[origin_col],
            value_vars=dev_cols,
            var_name="DevelopmentLag",
            value_name=value_col_name
        )
        # Convert DevelopmentLag to numeric if possible
        try:
            melted["DevelopmentLag"] = pd.to_numeric(melted["DevelopmentLag"])
        except Exception:
            pass
        # Sort values chronologically
        melted = melted.sort_values(by=[origin_col, "DevelopmentLag"]).reset_index(drop=True)
        return melted

    def _cross_check_entity_naming(
        self,
        entity_profile: ColumnProfile,
        column_profiles: list[ColumnProfile],
        reasons: list[str],
    ) -> None:
        """
        Checks whether any CATEGORY column with a similar unique count maps
        1-to-1 with the chosen entity column. Logs a reason if not -- this is
        informational (e.g. shared company display names), not necessarily an error.
        """
        candidates = [
            p
            for p in column_profiles
            if p.semantic_type == SemanticType.CATEGORY
            and abs(p.unique_count - entity_profile.unique_count) <= 2
        ]

        for candidate in candidates:
            mapping = self.df.groupby(candidate.name)[entity_profile.name].nunique()
            non_unique = mapping[mapping > 1]

            if len(non_unique) > 0:
                reasons.append(
                    f"Note: '{candidate.name}' does not map 1-to-1 with '{entity_profile.name}' -- "
                    f"{len(non_unique)} value(s) in '{candidate.name}' correspond to multiple "
                    f"'{entity_profile.name}' values (e.g. '{non_unique.index[0]}'). "
                    f"This may be expected (e.g. shared display names) but is worth noting."
                )
            else:
                reasons.append(
                    f"'{candidate.name}' maps cleanly 1-to-1 with '{entity_profile.name}'."
                )
