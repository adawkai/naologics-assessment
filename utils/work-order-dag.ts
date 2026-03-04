import { WorkOrder } from "../reflow/types";

export class WorkOrderDAG {
  private nodes: Map<string, WorkOrder> = new Map();
  private adjList: Map<string, string[]> = new Map();

  constructor(workOrders: WorkOrder[]) {
    for (const wo of workOrders) {
      this.nodes.set(wo.docId, wo);
    }
    for (const wo of workOrders) {
      // Only include dependencies that are actually in the input list
      const validDeps = wo.data.dependsOnWorkOrderIds.filter((id) =>
        this.nodes.has(id)
      );
      this.adjList.set(wo.docId, validDeps);
    }
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

  printGraph(): void {
    const childList = new Map<string, string[]>();
    const rootNodes: string[] = [];

    // Initialize childList and find root nodes
    for (const [nodeId, parents] of this.adjList.entries()) {
      if (parents.length === 0) {
        rootNodes.push(nodeId);
      }
      for (const parentId of parents) {
        const children = childList.get(parentId) || [];
        children.push(nodeId);
        childList.set(parentId, children);
      }
    }

    const displayNode = (
      id: string,
      prefix: string = "",
      isLast: boolean = true
    ) => {
      const node = this.nodes.get(id);
      if (!node) return;

      const connector = isLast ? "└── " : "├── ";
      console.log(`${prefix}${connector}${id} (${node.data.workOrderNumber})`);

      const children = childList.get(id) || [];
      const newPrefix = prefix + (isLast ? "    " : "│   ");

      children.forEach((childId, index) => {
        displayNode(childId, newPrefix, index === children.length - 1);
      });
    };

    if (rootNodes.length === 0 && this.nodes.size > 0) {
      console.log("(Circular dependencies or no roots found)");
      return;
    }

    rootNodes.forEach((rootId, index) => {
      displayNode(rootId, "", index === rootNodes.length - 1);
    });
  }

  toMermaid(): string {
    let mermaid = "graph TD\n";
    for (const [childId, parents] of this.adjList.entries()) {
      const child = this.nodes.get(childId);
      const childLabel = child
        ? `${childId}["${child.data.workOrderNumber}"]`
        : childId;

      if (parents.length === 0) {
        mermaid += `  ${childLabel}\n`;
      } else {
        for (const parentId of parents) {
          const parent = this.nodes.get(parentId);
          const parentLabel = parent
            ? `${parentId}["${parent.data.workOrderNumber}"]`
            : parentId;
          mermaid += `  ${parentLabel} --> ${childLabel}\n`;
        }
      }
    }
    return mermaid;
  }
}
