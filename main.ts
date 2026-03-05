import { writeFile } from "fs/promises";
import { ManufacturingOrder, WorkCenter, WorkOrder } from "./reflow/types";
import orderDataRaw from "./order.json";
import reflow from "./reflow/reflow.service";

// Define expected structure
interface OrderData {
  manufacturingOrders: ManufacturingOrder[];
  workCenters: WorkCenter[];
  workOrders: WorkOrder[];
}

const orderData = orderDataRaw as unknown as OrderData;

async function runReflowDemo() {
  const workOrders = orderData.workOrders ?? [];
  const workCenters = orderData.workCenters ?? [];
  const manufacturingOrders = orderData.manufacturingOrders ?? [];

  if (workOrders.length === 0 || workCenters.length === 0) {
    console.log("[]");
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
    "order-export.json",
    JSON.stringify(changedWorkOrdersWithMeta, null, 2),
    "utf-8"
  );
  console.log(JSON.stringify(changedWorkOrdersWithMeta, null, 2));
}

runReflowDemo().catch(async (error: unknown) => {
  await writeFile("order-export.json", "[]", "utf-8");
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error("unknown error");
});
