import { WorkOrder } from "../reflow/types";

export class WorkOrderDAG {
  private nodes: Map<string, WorkOrder> = new Map();
  private adjList: Map<string, string[]> = new Map();
  private missingDependencies: Array<{
    workOrderId: string;
    missingDependencyId: string;
  }> = [];

  constructor(workOrders: WorkOrder[]) {
    for (const wo of workOrders) {
      this.nodes.set(wo.docId, wo);
    }
    for (const wo of workOrders) {
      for (const dependencyId of wo.data.dependsOnWorkOrderIds) {
        if (!this.nodes.has(dependencyId)) {
          this.missingDependencies.push({
            workOrderId: wo.docId,
            missingDependencyId: dependencyId,
          });
        }
      }
      this.adjList.set(wo.docId, [...wo.data.dependsOnWorkOrderIds]);
    }

    this.validateDependenciesExist();
  }

  validateDependenciesExist(): void {
    if (this.missingDependencies.length === 0) {
      return;
    }

    const message = this.missingDependencies
      .map(
        (item) =>
          `${item.workOrderId} -> missing dependency ${item.missingDependencyId}`
      )
      .join(", ");

    throw new Error(`Missing dependency references detected: ${message}`);
  }

  detectCycle(): string[] | null {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const parentMap = new Map<string, string>();

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        const cycle = this.dfsDetectCycle(nodeId, visited, recStack, parentMap);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  private dfsDetectCycle(
    u: string,
    visited: Set<string>,
    recStack: Set<string>,
    parentMap: Map<string, string>
  ): string[] | null {
    visited.add(u);
    recStack.add(u);

    const neighbors = this.adjList.get(u) || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        parentMap.set(v, u);
        const cycle = this.dfsDetectCycle(v, visited, recStack, parentMap);
        if (cycle) return cycle;
      } else if (recStack.has(v)) {
        // Cycle detected
        const cycle: string[] = [v];
        let curr = u;
        while (curr !== v) {
          cycle.push(curr);
          curr = parentMap.get(curr)!;
        }
        cycle.push(v);
        return cycle.reverse();
      }
    }

    recStack.delete(u);
    return null;
  }

  /**
   * Performs a topological sort on the work orders.
   * Throws an error if a cycle is detected.
   */
  topologicalSort(): WorkOrder[] {
    const cycle = this.detectCycle();
    if (cycle) {
      throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    const visited = new Set<string>();
    const stack: string[] = [];

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        this.dfsSort(nodeId, visited, stack);
      }
    }

    return stack.map((id) => this.nodes.get(id)!);
  }

  private dfsSort(u: string, visited: Set<string>, stack: string[]) {
    visited.add(u);

    const neighbors = this.adjList.get(u) || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        this.dfsSort(v, visited, stack);
      }
    }

    stack.push(u);
  }
}
