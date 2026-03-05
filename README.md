# Reflow Scheduler

## Run the project

1. Install dependencies:
   - `npm install`
2. Run the project:
   - `npm start`

The script reads `order.json`, runs reflow logic, and writes changed work orders to `order-export.json`.

## Reflow logic (simple flow)

All main reflow steps are implemented in `reflow/reflow.service.ts`.

1. Build a DAG from work orders and topologically sort them.
2. Push sorted work orders into a stack (first sorted item at stack head).
3. For each work order, calculate start time from dependencies.
4. Prepare an empty `correctedWorkOrders` array for finalized results.

Loop until stack is empty:

1. Pop one work order from stack.
2. Check shift availability:
   - If start is outside shift, move start to nearest next shift start.
   - Set end = start + `durationMinutes`.
3. Check conflict with previously finalized work orders (same work center):
   - No conflict: keep interval.
   - Conflict: move start to conflict end and recalculate end.
   - If overlap requires split:
     - Split into first and second parts.
     - Keep first part before blocked interval.
     - Set second part after blocked interval.
     - Set second part dependency to first part.
     - Update dependent work orders to depend on second part.
     - Set second part id as `{originalId}-separated_{n}`.
     - Push second part back into stack.
4. Check maintenance-window overlap:
   - Apply same handling strategy as machine conflict (move or split).
5. Check shift-boundary gap overlap:
   - Apply same handling strategy as machine conflict (move or split).
6. Finalize current work order and push into `correctedWorkOrders`.

When stack is empty, return `correctedWorkOrders`.
