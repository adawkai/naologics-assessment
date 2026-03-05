import { writeFile } from "fs/promises";
import { ManufacturingOrder, WorkCenter, WorkOrder } from "./reflow/types";
import orderDataRaw from "./order.json";
import orderDataRaw1 from "./order1.json";
import orderDataRaw2 from "./order2.json";
import orderDataRaw3 from "./order3.json";
import reflow from "./reflow/reflow.service";

// Define expected structure
interface OrderData {
  manufacturingOrders: ManufacturingOrder[];
  workCenters: WorkCenter[];
  workOrders: WorkOrder[];
}

const orderData = orderDataRaw as unknown as OrderData;
const orderData1 = orderDataRaw1 as unknown as OrderData;
const orderData2 = orderDataRaw2 as unknown as OrderData;
const orderData3 = orderDataRaw3 as unknown as OrderData;

async function runScenario(data: OrderData, exportFileName: string) {
  const workOrders = data.workOrders ?? [];
  const workCenters = data.workCenters ?? [];
  const manufacturingOrders = data.manufacturingOrders ?? [];

  if (workOrders.length === 0 || workCenters.length === 0) {
    await writeFile(exportFileName, "[]", "utf-8");
    return;
  }

  const result = await reflow({
    workOrders,
    workCenters,
    manufacturingOrders,
  });

  const changedIds = new Set(
    result.changes
      .filter((item) => item.changeType === "rescheduled")
      .map((item) => item.workOrderId)
  );
  const changedWorkOrders = result.workOrders.filter((order) =>
    changedIds.has(order.docId)
  );
  const changedWorkOrdersWithMeta = changedWorkOrders.map((order) => {
    const reasons = result.explanations
      .filter((explanation) => explanation.workOrderId === order.docId)
      .map((explanation) => explanation.message);

    return {
      ...order,
      rescheduled: true,
      ...(reasons.length > 0 ? { reason: reasons.join(" | ") } : {}),
    };
  });

  await writeFile(
    exportFileName,
    JSON.stringify(changedWorkOrdersWithMeta, null, 2),
    "utf-8"
  );
}

async function runReflowDemo() {
  const scenarios: Array<{ data: OrderData; output: string }> = [
    { data: orderData, output: "order-export.json" },
    { data: orderData1, output: "order-export1.json" },
    { data: orderData2, output: "order-export2.json" },
    { data: orderData3, output: "order-export3.json" },
  ];

  for (const scenario of scenarios) {
    try {
      await runScenario(scenario.data, scenario.output);
    } catch {
      await writeFile(scenario.output, "[]", "utf-8");
    }
  }
}

runReflowDemo().catch(async () => {
  await writeFile("order-export.json", "[]", "utf-8");
  await writeFile("order-export1.json", "[]", "utf-8");
  await writeFile("order-export2.json", "[]", "utf-8");
  await writeFile("order-export3.json", "[]", "utf-8");
});
