/** Who holds a seat; `SeatRegistry` from the protocol package has the same shape. */
export type SeatOccupancy = { occupant(seatId: string): string | null };

/** The part of the joined room's state that seat occupancy reads. */
export type OccupancyRoom = {
  readonly state?: {
    readonly employees?: {
      forEach(
        callback: (
          employee: { readonly seatId: string; readonly activity?: string },
          sessionId: string,
        ) => void,
      ): void;
    };
  };
};

/**
 * REQ-INT-002, REQ-NET-002: seat occupancy read from replicated room state (each employee's
 * `seatId`), so the client never owns seats. Read on demand: the room state is live.
 */
export function roomOccupancy(room: OccupancyRoom): SeatOccupancy {
  return {
    occupant(seatId) {
      if (seatId === '') return null;
      let holder: string | null = null;
      room.state?.employees?.forEach((employee, sessionId) => {
        if (holder === null && employee.seatId === seatId) holder = sessionId;
      });
      return holder;
    },
  };
}

/**
 * REQ-INT-003 (T-1154): the employee brewing at the coffee machine, read from replicated
 * room state, or null when the machine is free. The server sends no refusal for a busy
 * machine, so the client shows "Machine in use" from this.
 */
export function roomBrewer(room: OccupancyRoom): () => string | null {
  return () => {
    let brewer: string | null = null;
    room.state?.employees?.forEach((employee, sessionId) => {
      if (brewer === null && employee.activity === 'brewing') brewer = sessionId;
    });
    return brewer;
  };
}
