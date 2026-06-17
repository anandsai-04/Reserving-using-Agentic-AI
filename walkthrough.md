# Project Walkthrough: Actuarial Reserving AI

This document summarizes the end-to-end development of the **Agentic AI Actuarial Reserving Platform**, built to intelligently process raw loss data, recommend reserving methodologies, calculate IBNR, and provide transparent AI narrations using Google's Gemini models.

## 1. The Architecture
We transitioned from an initial frontend-only prototype to a robust, decoupled architecture:
*   **Frontend (Dashboard)**: A sleek, dark-themed, Bloomberg-style static web application (HTML, CSS, vanilla JS) that handles user interaction, visualizes loss triangles, and streams AI chat.
*   **Backend (Python/FastAPI)**: A high-performance Python server that executes heavy mathematical computations and securely orchestrates Google GenAI agents.

## 2. Actuarial Data Core (`models/triangle.py`)
We built a highly robust data ingestion engine capable of standardizing messy actuarial data:
*   **Auto-Format Detection**: Intelligently detects whether an uploaded CSV is in "wide" format (already a triangle) or "long" format (transactional/aggregate rows).
*   **CAS Database Compatibility**: Specifically tuned to parse and automatically map headers from the standard **CAS Loss Reserve Database** (e.g., `comauto_pos.csv` recognizing `accidentyear`, `developmentlag`, `cumpaidloss_c`, and `earnedpremnet_c`).
*   **Loss Development Factors (LDFs)**: Automatically computes multiple LDF averages (Volume Weighted, Straight Average, 3-Year Weighted, 5-Year Weighted, and Coefficients of Variation) to give the user complete control over selections.

## 3. Reserving Models from Scratch (`models/methods.py`)
Rather than black-boxing the mathematics, we engineered **7 reserving models from scratch** in Python, mirroring the logic of the `chainladder-python` repository:
1.  **Chain Ladder (CL)**: Standard volume-weighted development.
2.  **Mack Chain Ladder (MCL)**: Stochastic Chain Ladder yielding standard errors, coefficients of variation (CV%), and confidence intervals (75th/95th percentiles).
3.  **Bornhuetter-Ferguson (BF)**: Incorporates A Priori loss ratios and premium data for unstable/immature accident years.
4.  **Benktander (BK)**: An iterative credibility-weighted blend of BF and CL methods.
5.  **Cape Cod (CC)**: The Stanard-Bühlmann method utilizing overall exposure trends.
6.  **Case Outstanding (CO)**: A baseline method projecting no future IBNR beyond known case reserves.
7.  **Clark Stochastic (CLK)**: A deterministic approximation of growth curve fitting for smoothing long-tail development.

## 4. The Agentic AI Layer (`agents.py`)
We utilized the official **`google-genai` Python SDK** to deploy four distinct AI agents that evaluate data in the background and narrate their findings to the UI:
*   **Data Summary Agent**: Triggers immediately upon CSV upload. It analyzes the matrix completeness, identifies missing data (like premiums or exposures), and flags if the data represents a volatile "new line of business".
*   **Analysis Agent**: Triggers after the triangle is generated. It powers a mathematical recommendation engine (`recommendation.py`) that scores all 7 models based on the data's characteristics (e.g., penalizing BF if premiums are missing, prioritizing Mack if variance tracking is needed), and narrates *why* a specific model is best suited for the data.
*   **Execution Agent**: Triggers after a model runs. It interprets the final calculations, explaining the magnitude of the calculated IBNR relative to paid losses and ultimate projections.
*   **Pair-Programming Chatbot**: A persistent agent in the left sidebar that maintains full context of the uploaded dataset, the selected LDFs, and the final results. It is capable of answering ad-hoc questions like *"Why did the Mack model output a high standard error for 2023?"*

## 5. Deployment and Handoff
*   **GitHub Integration**: The entire codebase was committed and pushed directly to your GitHub repository `anandsai-04/Reserving-using-Agentic-AI`.
*   **Local Setup**: The complete project was safely moved to your local `~/Documents/Reserving-using-Agentic-AI` folder.

You now possess a complete, locally executable AI-native actuarial platform!
