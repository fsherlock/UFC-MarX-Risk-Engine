# Plan: Resolve IDE Saturation and Verify App Stability

## **Summary**
The user reported a "freeze" and provided a screenshot showing a **Minified React error #185** in the Trae IDE. This error ("Maximum update depth exceeded") indicates that the IDE's internal UI crashed, likely due to the massive volume of task-tracking data (TODOs) being synchronized in every message. We will sanitize the environment to restore stability and conduct a final verification of the app's boot sequence.

## **Current State Analysis**
- **IDE Crash**: The React error #185 is specific to the Trae interface, not the user's MMA app. It is likely triggered by the 16+ items in the TODO list which are sent as metadata in every turn.
- **App Freeze**: The user previously reported a freeze at the "UFC Logo." While a "Panic Hide" fail-safe was implemented, the root cause might be a script execution delay or a remaining syntax error in the large `app.js` file.
- **Visual Integrity**: Chart aspect ratios have been locked, but need confirmation under high-load scenarios.

## **Proposed Changes**

### **1. Workspace & IDE Stability**
- **File**: `.trae/todo_list.json` (via `TodoWrite`)
- **Action**: Purge all "completed" tasks from the internal tracker.
- **Why**: To reduce the state-synchronization payload that is crashing the Trae React UI.

### **2. App Boot Verification**
- **File**: [app.js](file:///c%3A/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js)
- **Action**: Conduct a final audit of the `startApp` and `initAppLogic` functions. Ensure that no synchronous errors are thrown before the `setTimeout` and `requestIdleCallback` have a chance to fire.
- **Verification**: Use `console.log` markers at the very beginning of the script to track execution flow in the browser console.

### **3. Performance & Stress Test**
- **Action**: Execute `window.runUFCPerformanceAudit()` in the browser environment.
- **Goal**: Confirm that the new "Custom Fight Selection" logic and the "Upcoming Feed" row expansion do not cause main-thread blocking or memory leaks.

## **Assumptions & Decisions**
- The React error is a **side-effect of the complex coding session** (too much metadata) and not a bug in the project's code.
- The "UFC Logo" freeze is likely a timing issue between the intro animation and the `requestIdleCallback` DOM building.

## **Verification Steps**
1. **Prune Todos**: Call `TodoWrite` with `merge: false` and only 2-3 active tasks.
2. **Boot Audit**: Verify that the "Panic Hide" timer (5s) is working by intentionally introducing a temporary error and checking if the UI becomes accessible.
3. **Chart Integrity**: Select 5 fights from the new "Upcoming Feed," click "Build Card," and verify that all 4 charts (Radar, Portfolio, Monte Carlo, Singles) render with correct aspect ratios on both desktop and mobile viewports.
