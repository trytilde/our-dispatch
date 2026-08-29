// Marks an exit that a command has already explained in its own output.
//
// The CLI treats any non-zero exit as a crash and points at the run log. That is
// right for a thrown provider failure and wrong for a command whose whole job is
// to report a negative result — a validation command finding a missing tool is an
// answer, not a malfunction.
let reported = false;

/** Called by a command that has printed its own failure explanation. */
export function markDiagnosticExit(): void {
  reported = true;
}

export function diagnosticExitReported(): boolean {
  return reported;
}
