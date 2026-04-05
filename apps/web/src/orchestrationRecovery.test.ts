import { describe, expect, it } from "vitest";

import { createOrchestrationRecoveryCoordinator } from "./orchestrationRecovery";

describe("createOrchestrationRecoveryCoordinator", () => {
  it("defers live events until bootstrap completes and then requests replay", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.classifyDomainEvent(4)).toBe("defer");

    expect(coordinator.completeSnapshotRecovery(2)).toBe(true);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 2,
      highestObservedSequence: 4,
      bootstrapped: true,
      pendingReplay: false,
      inFlight: null,
    });
  });

  it("classifies sequence gaps as recovery-only replay work", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.classifyDomainEvent(5)).toBe("recover");
    expect(coordinator.beginReplayRecovery("sequence-gap")).toBe(true);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "replay",
      reason: "sequence-gap",
    });
  });

  it("tracks live event batches without entering recovery", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.classifyDomainEvent(4)).toBe("apply");
    expect(coordinator.markEventBatchApplied([{ sequence: 4 }])).toEqual([{ sequence: 4 }]);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 4,
      highestObservedSequence: 4,
      bootstrapped: true,
      inFlight: null,
    });
  });

  it("requests another replay when deferred events arrive during replay recovery", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    coordinator.classifyDomainEvent(5);
    coordinator.beginReplayRecovery("sequence-gap");
    coordinator.classifyDomainEvent(7);
    coordinator.markEventBatchApplied([{ sequence: 4 }, { sequence: 5 }, { sequence: 6 }]);

    expect(coordinator.completeReplayRecovery()).toBe(true);
  });

  it("does not immediately replay again when replay returns no new events", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    coordinator.classifyDomainEvent(5);
    coordinator.beginReplayRecovery("sequence-gap");

    expect(coordinator.completeReplayRecovery()).toBe(false);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 3,
      highestObservedSequence: 5,
      pendingReplay: false,
      inFlight: null,
    });
  });

  it("marks replay failure as unbootstrapped so snapshot fallback is recovery-only", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    coordinator.beginReplayRecovery("sequence-gap");
    coordinator.failReplayRecovery();

    expect(coordinator.getState()).toMatchObject({
      bootstrapped: false,
      inFlight: null,
    });
    expect(coordinator.beginSnapshotRecovery("replay-failed")).toBe(true);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "snapshot",
      reason: "replay-failed",
    });
  });

  it("keeps enough state to explain why bootstrap snapshot recovery requests replay", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.classifyDomainEvent(4)).toBe("defer");
    expect(coordinator.completeSnapshotRecovery(2)).toBe(true);

    expect(coordinator.getState()).toMatchObject({
      latestSequence: 2,
      highestObservedSequence: 4,
      bootstrapped: true,
      pendingReplay: false,
      inFlight: null,
    });
  });

  it("reports skip state when snapshot recovery is requested while replay is in flight", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    expect(coordinator.beginReplayRecovery("sequence-gap")).toBe(true);

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(false);
    expect(coordinator.getState()).toMatchObject({
      pendingReplay: true,
      inFlight: {
        kind: "replay",
        reason: "sequence-gap",
      },
    });
  });

  it("ignores duplicate events with already-applied sequences", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(5);

    expect(coordinator.classifyDomainEvent(3)).toBe("ignore");
    expect(coordinator.classifyDomainEvent(5)).toBe("ignore");
    expect(coordinator.getState().latestSequence).toBe(5);
  });

  it("markEventBatchApplied filters out already-applied sequences", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    const applied = coordinator.markEventBatchApplied([
      { sequence: 2 },
      { sequence: 3 },
      { sequence: 4 },
      { sequence: 5 },
    ]);
    expect(applied).toEqual([{ sequence: 4 }, { sequence: 5 }]);
    expect(coordinator.getState().latestSequence).toBe(5);
  });

  it("serializes concurrent recovery attempts — second snapshot deferred while first in flight", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(false);
    expect(coordinator.getState().pendingReplay).toBe(true);
  });

  it("serializes concurrent recovery — replay deferred while snapshot in flight", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.beginReplayRecovery("sequence-gap")).toBe(false);
    expect(coordinator.getState().pendingReplay).toBe(true);
  });

  it("events arriving between replay start and complete trigger another replay", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    // Gap detected, start replay
    coordinator.classifyDomainEvent(5);
    coordinator.beginReplayRecovery("sequence-gap");

    // Replay fetches events 4-5
    coordinator.markEventBatchApplied([{ sequence: 4 }, { sequence: 5 }]);

    // Meanwhile, event 8 arrived (deferred during replay)
    coordinator.classifyDomainEvent(8);

    // Replay completes — should request another replay since events arrived
    expect(coordinator.completeReplayRecovery()).toBe(true);
    expect(coordinator.getState().latestSequence).toBe(5);
    expect(coordinator.getState().highestObservedSequence).toBe(8);
  });

  it("failSnapshotRecovery clears inFlight without changing bootstrap state", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.failSnapshotRecovery();

    expect(coordinator.getState()).toMatchObject({
      bootstrapped: false,
      inFlight: null,
    });
  });
});
