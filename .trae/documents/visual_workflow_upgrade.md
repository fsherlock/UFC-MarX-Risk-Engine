# Plan: UFC MarX Visual & Workflow Upgrade (Anthropic Brand + Advanced Charts)

This plan outlines the visual overhaul of the UFC MarX Risk Engine, applying the Anthropic brand identity and integrating professional data visualizations using the `chart-visualization` skill.

## 1. Summary
The goal is to transition the current dark/red aesthetic to a refined, user-friendly interface based on Anthropic's brand guidelines while upgrading the analytical power of the platform through advanced charting. We will replace basic canvas drawings with high-fidelity charts for Monte Carlo simulations, strategy comparisons, and risk analysis.

## 2. Current State Analysis
- **UI Framework**: Tailwind CSS + Vanilla JS.
- **Aesthetic**: Generic dark theme (`bg-gray-950`) with red accents.
- **Visualization**: Basic HTML5 Canvas sparklines and CSS-based progress bars for Tale of the Tape.
- **Workflow**: Linear but could benefit from better visual hierarchy and feedback during heavy calculations (Monte Carlo).

## 3. Proposed Changes

### Phase 1: Brand Guidelines Integration (`index.html`, `css/style.css`)
- **Typography**: 
  - Apply `Poppins` (Headings) and `Lora` (Body) as primary fonts.
  - Update `tailwind.config` font families.
- **Color Palette**:
  - Background: `#141413` (Dark) for main containers and body.
  - Surface: `#faf9f5` (Light) for text on dark backgrounds and subtle accents.
  - Accents: 
    - Orange (`#d97757`) for primary actions and "Lock" status.
    - Blue (`#6a9bcc`) for "Market" data and "Fade" status.
    - Green (`#788c5d`) for "Win/ROI" metrics.
- **Components**:
  - Refine `intro-screen` with the new color palette.
  - Update `header` and `nav-pill` styling to match Anthropic's look-and-feel.

### Phase 2: Advanced Data Visualization (`js/app.js`, `index.html`)
- **Monte Carlo Distribution**:
  - Replace `drawHistogram` in [app.js](file:///c%3A/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) with a professional **Boxplot** or **Violin Chart** using the `chart-visualization` skill to show P5, Median, and P95 distributions.
- **Risk & Strategy Comparison**:
  - Add a **Radar Chart** to the `riskSummary` panel to visualize multi-dimensional strategy performance (EV, Drawdown, Exposure, Volatility).
- **Tale of the Tape**:
  - Replace the CSS-bar grid in [index.html](file:///c%3A/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/index.html#L411-450) with a **Grouped Bar Chart** for reach, height, and win-rate comparisons.
- **Portfolio Trends**:
  - Upgrade the `savedSparkline` in the dashboard to an **Area Chart** showing accumulated ROI over time.

### Phase 3: Workflow & UX Enhancements
- **Interactive Feedback**:
  - Implement a `liquid_chart` or `progress_bar` from the chart skill to show Monte Carlo simulation progress.
- **Fighter Selection**:
  - Enhance the `autocomplete` results with "Quick Stats" badges using brand accent colors.
- **Strategy Cards**:
  - Redesign strategy cards to emphasize "Best Fit" based on the user's risk tolerance.

## 4. Verification Steps
- **Visual Audit**: Verify color contrast and typography against Anthropic brand guidelines.
- **Chart Validation**: Ensure all generated chart URLs are accessible and correctly represent the underlying Monte Carlo data.
- **Responsiveness**: Test the new grid-based chart layouts on mobile and desktop.
- **Calculation Accuracy**: Confirm that the visual upgrade does not affect the mathematical parity of the `fightnomics.js` engine.
