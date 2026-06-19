import pandas as pd

class OnLevelPremiumCalculator:
    def __init__(self, premiums_df, rate_changes_df):
        """
        premiums_df columns:
            accident_year
            earned_premium

        rate_changes_df columns:
            effective_date
            rate_change

        Example rate_change:
            0.05  = +5%
           -0.02 = -2%
        """
        self.premiums = premiums_df.copy()
        self.rate_changes = rate_changes_df.copy()

    # --------------------------------------------------
    # BUILD RATE LEVELS
    # --------------------------------------------------
    def build_rate_levels(self):
        self.rate_changes["effective_date"] = pd.to_datetime(
            self.rate_changes["effective_date"]
        )

        self.rate_changes = self.rate_changes.sort_values(
            "effective_date"
        )

        self.rate_changes["rate_level"] = (
            1 + self.rate_changes["rate_change"]
        ).cumprod()

        base_row = pd.DataFrame({
            "effective_date": [pd.Timestamp("1900-01-01")],
            "rate_change": [0.0],
            "rate_level": [1.0]
        })

        self.rate_levels = pd.concat(
            [base_row, self.rate_changes],
            ignore_index=True
        )

        self.current_rate_level = (
            self.rate_levels["rate_level"].iloc[-1]
        )

    # --------------------------------------------------
    # AVERAGE RATE LEVEL FOR AN AY
    # --------------------------------------------------
    def average_rate_level(self, ay):
        start = pd.Timestamp(f"{ay}-01-01")
        end = pd.Timestamp(f"{ay+1}-01-01")

        breakpoints = [start]

        for d in self.rate_levels["effective_date"]:
            if start < d < end:
                breakpoints.append(d)

        breakpoints.append(end)
        breakpoints = sorted(breakpoints)

        weighted_rl = 0.0
        total_days = (end - start).days

        for i in range(len(breakpoints) - 1):
            seg_start = breakpoints[i]
            seg_end = breakpoints[i + 1]
            days = (seg_end - seg_start).days

            rl = (
                self.rate_levels.loc[
                    self.rate_levels["effective_date"] <= seg_start,
                    "rate_level"
                ].iloc[-1]
            )
            weighted_rl += rl * days

        return weighted_rl / total_days

    # --------------------------------------------------
    # CALCULATE ON-LEVEL PREMIUMS
    # --------------------------------------------------
    def calculate(self):
        if self.rate_changes.empty:
            # If no rate changes, just return premiums with olf=1.0
            results = []
            for _, row in self.premiums.iterrows():
                ay = row["accident_year"]
                earned_premium = row["earned_premium"]
                results.append({
                    "accident_year": ay,
                    "earned_premium": earned_premium,
                    "average_rate_level": 1.0,
                    "olf": 1.0,
                    "on_level_premium": earned_premium
                })
            return pd.DataFrame(results)

        self.build_rate_levels()

        results = []
        for _, row in self.premiums.iterrows():
            ay = row["accident_year"]
            earned_premium = row["earned_premium"]

            avg_rl = self.average_rate_level(ay)

            olf = (
                self.current_rate_level / avg_rl
            )

            on_level_premium = (
                earned_premium * olf
            )

            results.append({
                "accident_year": ay,
                "earned_premium": earned_premium,
                "average_rate_level": round(avg_rl, 4),
                "olf": round(olf, 4),
                "on_level_premium": round(on_level_premium, 2)
            })

        return pd.DataFrame(results)
