export type ManufacturingOrder = {
  docId: string;
  docType: "ManufacturingOrder";
  data: {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;
  };
};

export type WorkCenter = {
  docId: string;
  docType: "workCenter";
  data: {
    name: string;
    // Shifts
    shifts: Array<{
      dayOfWeek: number; // 0-6, Sunday = 0
      startHour: number; // 0-23
      endHour: number; // 0-23
    }>;
    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<{
      startDate: string;
      endDate: string;
      reason?: string; // Optional description
    }>;
  };
};

export type WorkOrder = {
  docId: string;
  docType: "workOrder";
  data: {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;

    // Timing
    startDate: string;
    endDate: string;
    durationMinutes: number; // Total working time required

    // Constraints
    isMaintenance: boolean; // Cannot be rescheduled if true

    // Dependencies (can have multiple parents)
    dependsOnWorkOrderIds: string[]; // All must complete before this starts
  };
};
