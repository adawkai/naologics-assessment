import { WorkCenter, WorkOrder } from "./types";
import {
  isBefore,
  isSameOrAfter,
  parseIsoUtc,
  toMillis,
} from "../utils/date-utils";

export type TimeInterval = {
  start: Date;
  end: Date;
  sourceId?: string;
};

export function validateConstraintInputs(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): void {
  const workCenterIds = new Set(workCenters.map((center) => center.docId));
  const workOrderIds = new Set(workOrders.map((order) => order.docId));

  for (const order of workOrders) {
    if (!workCenterIds.has(order.data.workCenterId)) {
      throw new Error(
        `Work order ${order.docId} references unknown work center ${order.data.workCenterId}.`
      );
    }

    if (order.data.durationMinutes <= 0) {
      throw new Error(
        `Work order ${order.docId} has invalid durationMinutes=${order.data.durationMinutes}.`
      );
    }

    parseIsoUtc(order.data.startDate, `work order ${order.docId} startDate`);
    parseIsoUtc(order.data.endDate, `work order ${order.docId} endDate`);

    for (const depId of order.data.dependsOnWorkOrderIds) {
      if (!workOrderIds.has(depId)) {
        throw new Error(
          `Work order ${order.docId} has missing dependency ${depId}.`
        );
      }
    }
  }

  for (const center of workCenters) {
    if (center.data.shifts.length === 0) {
      throw new Error(`Work center ${center.docId} has no configured shifts.`);
    }

    for (const shift of center.data.shifts) {
      if (
        shift.dayOfWeek < 0 ||
        shift.dayOfWeek > 6 ||
        shift.startHour < 0 ||
        shift.startHour > 23 ||
        shift.endHour < 0 ||
        shift.endHour > 23
      ) {
        throw new Error(`Work center ${center.docId} has an invalid shift.`);
      }
    }

    for (const window of center.data.maintenanceWindows) {
      const start = parseIsoUtc(
        window.startDate,
        `work center ${center.docId} maintenance startDate`
      );
      const end = parseIsoUtc(
        window.endDate,
        `work center ${center.docId} maintenance endDate`
      );
      if (isSameOrAfter(start, end)) {
        throw new Error(
          `Work center ${center.docId} has maintenance window with start >= end.`
        );
      }
    }
  }
}

export function createMaintenanceIntervals(
  workCenter: WorkCenter
): TimeInterval[] {
  return workCenter.data.maintenanceWindows
    .map((window) => ({
      start: parseIsoUtc(window.startDate),
      end: parseIsoUtc(window.endDate),
    }))
    .sort((a, b) => toMillis(a.start) - toMillis(b.start));
}

export function overlaps(left: TimeInterval, right: TimeInterval): boolean {
  return isBefore(left.start, right.end) && isBefore(right.start, left.end);
}

export function findFirstOverlap(
  target: TimeInterval,
  candidates: TimeInterval[]
): TimeInterval | null {
  for (const interval of candidates) {
    if (overlaps(target, interval)) {
      return interval;
    }
  }

  return null;
}
