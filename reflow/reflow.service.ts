import { WorkOrderDAG } from "../utils/work-order-dag";
import {
  createMaintenanceIntervals,
  findFirstOverlap,
  overlaps,
  TimeInterval,
  validateConstraintInputs,
} from "./constraint-checker";
import {
  addDaysUtc,
  addHoursUtc,
  addMinutesUtc,
  diffMinutesFloor,
  isAfter,
  isBefore,
  isSameOrAfter,
  maxDate,
  parseIsoUtc,
  startOfUtcDay,
  toIsoUtc,
  toMillis,
  utcDayOfWeekSundayZero,
} from "../utils/date-utils";
import {
  ManufacturingOrder,
  ReflowResult,
  ScheduleChange,
  ScheduleExplanation,
  WorkCenter,
  WorkOrder,
} from "./types";

export type ReflowServiceOptions = {
  workOrders: WorkOrder[];
  workCenters: WorkCenter[];
  manufacturingOrders: ManufacturingOrder[];
};

function findDependencyReadyTime(
  workOrder: WorkOrder,
  scheduledById: Map<string, WorkOrder>
): Date {
  let readyAt = parseIsoUtc(workOrder.data.startDate);

  for (const dependencyId of workOrder.data.dependsOnWorkOrderIds) {
    const dependency = scheduledById.get(dependencyId);
    if (!dependency) {
      throw new Error(
        `Dependency ${dependencyId} for ${workOrder.docId} is not yet scheduled.`
      );
    }

    const dependencyEnd = parseIsoUtc(dependency.data.endDate);
    readyAt = maxDate(readyAt, dependencyEnd);
  }

  return readyAt;
}

export default function reflow({
  workOrders,
  workCenters,
  manufacturingOrders,
}: ReflowServiceOptions): Promise<ReflowResult> {
  void manufacturingOrders;
  validateConstraintInputs(workOrders, workCenters);

  const workCenterById = new Map(
    workCenters.map((center) => [center.docId, center])
  );
  const maintenanceByWorkCenter = new Map<string, TimeInterval[]>();
  const timelineByWorkCenter = new Map<string, TimeInterval[]>();
  const separatedCounters = new Map<string, number>();
  const correctedWorkOrders: WorkOrder[] = [];
  const correctedById = new Map<string, WorkOrder>();
  const explanationByOrder = new Map<string, ScheduleExplanation[]>();

  const addExplanation = (
    workOrderId: string,
    rule: ScheduleExplanation["rule"],
    message: string
  ): void => {
    const list = explanationByOrder.get(workOrderId) ?? [];
    if (!list.some((item) => item.rule === rule && item.message === message)) {
      list.push({ workOrderId, rule, message });
      explanationByOrder.set(workOrderId, list);
    }
  };

  for (const center of workCenters) {
    maintenanceByWorkCenter.set(
      center.docId,
      createMaintenanceIntervals(center)
    );
    timelineByWorkCenter.set(center.docId, []);
  }

  const workOrderDAG = new WorkOrderDAG(workOrders);
  const stack = [...workOrderDAG.topologicalSort()];

  while (stack.length > 0) {
    let workOrder = cloneWorkOrder(stack.shift()!);
    const workCenter = workCenterById.get(workOrder.data.workCenterId);
    if (!workCenter) {
      throw new Error(
        `Work order ${workOrder.docId} references unknown work center ${workOrder.data.workCenterId}.`
      );
    }

    const centerMaintenance =
      maintenanceByWorkCenter.get(workCenter.docId) ?? [];
    const centerTimeline = timelineByWorkCenter.get(workCenter.docId) ?? [];

    const dependencyReadyTime = findDependencyReadyTime(
      workOrder,
      correctedById
    );
    const requestedStart = parseIsoUtc(workOrder.data.startDate);
    let candidateStart = maxDate(requestedStart, dependencyReadyTime);

    if (isAfter(dependencyReadyTime, requestedStart)) {
      addExplanation(
        workOrder.docId,
        "dependency_gate",
        `Start moved to ${toIsoUtc(
          dependencyReadyTime
        )} after parent dependencies completed.`
      );
    }

    candidateStart = ensureShiftStart(candidateStart, workCenter);
    let candidateEnd = addMinutesUtc(
      candidateStart,
      workOrder.data.durationMinutes
    );
    let guard = 0;

    while (true) {
      guard += 1;
      if (guard > 20000) {
        throw new Error(`Unable to place ${workOrder.docId}.`);
      }

      const candidateRange: TimeInterval = {
        start: candidateStart,
        end: candidateEnd,
      };
      const machineConflict = findFirstOverlap(candidateRange, centerTimeline);

      if (machineConflict) {
        const split = splitAroundBlockedInterval(
          workOrder,
          candidateStart,
          candidateEnd,
          machineConflict.start,
          machineConflict.end,
          separatedCounters
        );
        if (split) {
          workOrder = split.first;
          candidateStart = parseIsoUtc(split.first.data.startDate);
          candidateEnd = parseIsoUtc(split.first.data.endDate);
          rewireDependents(workOrder.docId, split.second.docId, stack);
          stack.unshift(split.second);
          addExplanation(
            workOrder.docId,
            "machine_conflict",
            `Split due to machine conflict ${toIsoUtc(
              machineConflict.start
            )} - ${toIsoUtc(machineConflict.end)}.`
          );
          continue;
        }
        candidateStart = machineConflict.end;
        candidateEnd = addMinutesUtc(
          candidateStart,
          workOrder.data.durationMinutes
        );
        addExplanation(
          workOrder.docId,
          "machine_conflict",
          `Moved start to ${toIsoUtc(candidateStart)} due to machine conflict.`
        );
        continue;
      }

      const maintenanceConflict = findFirstOverlap(
        candidateRange,
        centerMaintenance
      );
      if (maintenanceConflict) {
        const split = splitAroundBlockedInterval(
          workOrder,
          candidateStart,
          candidateEnd,
          maintenanceConflict.start,
          maintenanceConflict.end,
          separatedCounters
        );
        if (split) {
          workOrder = split.first;
          candidateStart = parseIsoUtc(split.first.data.startDate);
          candidateEnd = parseIsoUtc(split.first.data.endDate);
          rewireDependents(workOrder.docId, split.second.docId, stack);
          stack.unshift(split.second);
          addExplanation(
            workOrder.docId,
            "maintenance_window",
            `Split due to maintenance window ${toIsoUtc(
              maintenanceConflict.start
            )} - ${toIsoUtc(maintenanceConflict.end)}.`
          );
          continue;
        }
        candidateStart = maintenanceConflict.end;
        candidateEnd = addMinutesUtc(
          candidateStart,
          workOrder.data.durationMinutes
        );
        addExplanation(
          workOrder.docId,
          "maintenance_window",
          `Moved start to ${toIsoUtc(
            candidateStart
          )} due to maintenance window.`
        );
        continue;
      }

      const shiftGap = findShiftBoundaryGap(
        candidateStart,
        candidateEnd,
        workCenter
      );
      if (shiftGap) {
        const split = splitAroundBlockedInterval(
          workOrder,
          candidateStart,
          candidateEnd,
          shiftGap.start,
          shiftGap.end,
          separatedCounters
        );
        if (split) {
          workOrder = split.first;
          candidateStart = parseIsoUtc(split.first.data.startDate);
          candidateEnd = parseIsoUtc(split.first.data.endDate);
          rewireDependents(workOrder.docId, split.second.docId, stack);
          stack.unshift(split.second);
          addExplanation(
            workOrder.docId,
            "shift_boundary",
            `Split due to shift boundary gap ${toIsoUtc(
              shiftGap.start
            )} - ${toIsoUtc(shiftGap.end)}.`
          );
          continue;
        }
      }

      const finalizedOrder = cloneWithSchedule(
        workOrder,
        toIsoUtc(candidateStart),
        toIsoUtc(candidateEnd)
      );
      finalizedOrder.data.durationMinutes = diffMinutesFloor(
        candidateStart,
        candidateEnd
      );
      correctedWorkOrders.push(finalizedOrder);
      correctedById.set(finalizedOrder.docId, finalizedOrder);
      centerTimeline.push({
        start: candidateStart,
        end: candidateEnd,
        sourceId: finalizedOrder.docId,
      });
      centerTimeline.sort((a, b) => toMillis(a.start) - toMillis(b.start));
      break;
    }
  }

  const finalWorkOrders = correctedWorkOrders;

  assertDependenciesSatisfied(finalWorkOrders);
  assertNoWorkCenterOverlap(finalWorkOrders);

  const originalById = new Map(workOrders.map((item) => [item.docId, item]));
  const changes: ScheduleChange[] = finalWorkOrders.map((afterOrder) => {
    const beforeOrder = originalById.get(afterOrder.docId);
    if (!beforeOrder) {
      return {
        workOrderId: afterOrder.docId,
        changeType: "rescheduled",
        before: {
          workCenterId: afterOrder.data.workCenterId,
          startDate: afterOrder.data.startDate,
          endDate: afterOrder.data.endDate,
        },
        after: {
          workCenterId: afterOrder.data.workCenterId,
          startDate: afterOrder.data.startDate,
          endDate: afterOrder.data.endDate,
        },
        movedStartByMinutes: 0,
        movedEndByMinutes: 0,
      };
    }
    const beforeStart = toMillis(parseIsoUtc(beforeOrder.data.startDate));
    const beforeEnd = toMillis(parseIsoUtc(beforeOrder.data.endDate));
    const afterStart = toMillis(parseIsoUtc(afterOrder.data.startDate));
    const afterEnd = toMillis(parseIsoUtc(afterOrder.data.endDate));

    return {
      workOrderId: afterOrder.docId,
      changeType:
        beforeOrder.data.startDate === afterOrder.data.startDate &&
        beforeOrder.data.endDate === afterOrder.data.endDate
          ? "unchanged"
          : "rescheduled",
      before: {
        workCenterId: beforeOrder.data.workCenterId,
        startDate: beforeOrder.data.startDate,
        endDate: beforeOrder.data.endDate,
      },
      after: {
        workCenterId: afterOrder.data.workCenterId,
        startDate: afterOrder.data.startDate,
        endDate: afterOrder.data.endDate,
      },
      movedStartByMinutes: Math.round((afterStart - beforeStart) / 60000),
      movedEndByMinutes: Math.round((afterEnd - beforeEnd) / 60000),
    };
  });

  const explanations = Array.from(explanationByOrder.values()).flat();

  return Promise.resolve({
    workOrders: finalWorkOrders,
    changes,
    explanations,
  });
}

function ensureShiftStart(start: Date, workCenter: WorkCenter): Date {
  const activeShift = getActiveShiftIntervalAt(start, workCenter);
  if (activeShift) {
    return start;
  }

  const nextShiftStart = getNextShiftStartAtOrAfter(start, workCenter);
  if (!nextShiftStart) {
    throw new Error(
      `No upcoming shift found for work center ${workCenter.docId}.`
    );
  }
  return nextShiftStart;
}

function findShiftBoundaryGap(
  start: Date,
  end: Date,
  workCenter: WorkCenter
): TimeInterval | null {
  const activeShift = getActiveShiftIntervalAt(start, workCenter);
  if (!activeShift) {
    return null;
  }

  if (!isAfter(end, activeShift.end)) {
    return null;
  }

  const nextShiftStart = getNextShiftStartAtOrAfter(
    activeShift.end,
    workCenter
  );
  if (!nextShiftStart) {
    throw new Error(
      `No upcoming shift found for work center ${workCenter.docId}.`
    );
  }

  return {
    start: activeShift.end,
    end: nextShiftStart,
  };
}

function getActiveShiftIntervalAt(
  value: Date,
  workCenter: WorkCenter
): TimeInterval | null {
  const candidates: TimeInterval[] = [];
  const baseDay = startOfUtcDay(value);
  const dayOfWeek = utcDayOfWeekSundayZero(baseDay);

  for (const shift of workCenter.data.shifts) {
    if (shift.dayOfWeek !== dayOfWeek) {
      continue;
    }

    const start = addHoursUtc(baseDay, shift.startHour);
    const end =
      shift.endHour > shift.startHour
        ? addHoursUtc(baseDay, shift.endHour)
        : addHoursUtc(addDaysUtc(baseDay, 1), shift.endHour);

    if (isSameOrAfter(value, start) && isBefore(value, end)) {
      candidates.push({ start, end });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => toMillis(a.end) - toMillis(b.end))[0];
}

function getNextShiftStartAtOrAfter(
  value: Date,
  workCenter: WorkCenter
): Date | null {
  const startDay = startOfUtcDay(value);
  const candidates: Date[] = [];

  for (let dayOffset = 0; dayOffset <= 21; dayOffset += 1) {
    const day = addDaysUtc(startDay, dayOffset);
    const dayOfWeek = utcDayOfWeekSundayZero(day);

    for (const shift of workCenter.data.shifts) {
      if (shift.dayOfWeek !== dayOfWeek) {
        continue;
      }

      const shiftStart = addHoursUtc(day, shift.startHour);
      if (isSameOrAfter(shiftStart, value)) {
        candidates.push(shiftStart);
      }
    }

    if (candidates.length > 0) {
      break;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => toMillis(a) - toMillis(b))[0];
}

function splitAroundBlockedInterval(
  workOrder: WorkOrder,
  start: Date,
  end: Date,
  blockStart: Date,
  blockEnd: Date,
  separatedCounters: Map<string, number>
): { first: WorkOrder; second: WorkOrder } | null {
  const overlapsBlock = isBefore(start, blockEnd) && isAfter(end, blockStart);
  if (!overlapsBlock) {
    return null;
  }

  if (!isBefore(start, blockStart) || !isAfter(end, blockStart)) {
    return null;
  }

  const totalDuration = workOrder.data.durationMinutes;
  const firstDuration = diffMinutesFloor(start, blockStart);
  if (firstDuration <= 0 || firstDuration >= totalDuration) {
    return null;
  }
  const secondDuration = totalDuration - firstDuration;
  if (secondDuration <= 0) {
    return null;
  }

  const first = cloneWithSchedule(
    workOrder,
    toIsoUtc(start),
    toIsoUtc(blockStart)
  );
  first.data.durationMinutes = firstDuration;

  const secondEnd = addMinutesUtc(blockEnd, secondDuration);
  const second = cloneWithSchedule(
    workOrder,
    toIsoUtc(blockEnd),
    toIsoUtc(secondEnd)
  );
  second.docId = nextSeparatedId(workOrder.docId, separatedCounters);
  second.data.durationMinutes = secondDuration;
  second.data.dependsOnWorkOrderIds = [first.docId];

  return { first, second };
}

function rewireDependents(
  oldDependencyId: string,
  newDependencyId: string,
  workOrders: WorkOrder[]
): void {
  for (const workOrder of workOrders) {
    if (!workOrder.data.dependsOnWorkOrderIds.includes(oldDependencyId)) {
      continue;
    }
    workOrder.data.dependsOnWorkOrderIds =
      workOrder.data.dependsOnWorkOrderIds.map((dependencyId) =>
        dependencyId === oldDependencyId ? newDependencyId : dependencyId
      );
  }
}

function nextSeparatedId(
  baseId: string,
  separatedCounters: Map<string, number>
): string {
  const nextCounter = (separatedCounters.get(baseId) ?? 0) + 1;
  separatedCounters.set(baseId, nextCounter);
  return `${baseId}-separated_${nextCounter}`;
}

function assertDependenciesSatisfied(workOrders: WorkOrder[]): void {
  const byId = new Map(
    workOrders.map((workOrder) => [workOrder.docId, workOrder])
  );

  for (const workOrder of workOrders) {
    const start = parseIsoUtc(workOrder.data.startDate);
    for (const dependencyId of workOrder.data.dependsOnWorkOrderIds) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(
          `Unable to verify dependency ${dependencyId} for ${workOrder.docId}.`
        );
      }
      const depEnd = parseIsoUtc(dependency.data.endDate);
      if (isBefore(start, depEnd)) {
        throw new Error(
          `Dependency violation: ${workOrder.docId} starts at ${toIsoUtc(
            start
          )} before ${dependencyId} ends at ${toIsoUtc(depEnd)}.`
        );
      }
    }
  }
}

function assertNoWorkCenterOverlap(workOrders: WorkOrder[]): void {
  const byCenter = new Map<string, WorkOrder[]>();

  for (const workOrder of workOrders) {
    const list = byCenter.get(workOrder.data.workCenterId) ?? [];
    list.push(workOrder);
    byCenter.set(workOrder.data.workCenterId, list);
  }

  for (const [centerId, centerOrders] of byCenter.entries()) {
    centerOrders.sort(
      (left, right) =>
        toMillis(parseIsoUtc(left.data.startDate)) -
        toMillis(parseIsoUtc(right.data.startDate))
    );

    for (let i = 0; i < centerOrders.length - 1; i += 1) {
      const current = centerOrders[i];
      const next = centerOrders[i + 1];
      const currentRange: TimeInterval = {
        start: parseIsoUtc(current.data.startDate),
        end: parseIsoUtc(current.data.endDate),
      };
      const nextRange: TimeInterval = {
        start: parseIsoUtc(next.data.startDate),
        end: parseIsoUtc(next.data.endDate),
      };

      if (overlaps(currentRange, nextRange)) {
        throw new Error(
          `Work center overlap on ${centerId}: ${current.docId} conflicts with ${next.docId}.`
        );
      }
    }
  }
}

function cloneWorkOrder(workOrder: WorkOrder): WorkOrder {
  return {
    ...workOrder,
    data: {
      ...workOrder.data,
      dependsOnWorkOrderIds: [...workOrder.data.dependsOnWorkOrderIds],
    },
  };
}

function cloneWithSchedule(
  workOrder: WorkOrder,
  startDate: string,
  endDate: string
): WorkOrder {
  return {
    ...workOrder,
    data: {
      ...workOrder.data,
      startDate,
      endDate,
      dependsOnWorkOrderIds: [...workOrder.data.dependsOnWorkOrderIds],
    },
  };
}
