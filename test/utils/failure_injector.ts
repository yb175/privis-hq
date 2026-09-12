import { readFileSync } from 'fs';

/**
 * Test‑only failure injection helper.
 * The production build never imports this module because the import is guarded by the
 * `process.env.TEST_FAILURE_INJECTION` flag which is only set in the failure‑injection test
 * harness.
 */
export function maybeInject<T>(id: string, fn: () => T | Promise<T>): T | Promise<T> {
  const envId = process.env.FAIL_INJECTION_ID;
  if (!envId) {
    // No injection requested – run normally.
    return fn();
  }
  if (envId !== id) {
    return fn();
  }
  // Match – perform the injected failure based on scenario ID.
  switch (id) {
    // Frontend / UI scenarios
    case 'F001': // double submit
      // Simulate a rejected duplicate request.
      throw new Error('Injected double‑submit failure');
    case 'F002': // cancellation during execution
      // Throw a cancellation error that the surrounding code should catch.
      throw new Error('Injected cancellation while running');
    case 'F003': // malformed message payload
      // Simulate parsing error by throwing inside the handler.
      throw new Error('Injected malformed message error');
    case 'F004': // duplicate response
      // Return a special marker that the caller can treat as duplicate.
      // For simplicity we just throw – the caller's error handling will be exercised.
      throw new Error('Injected duplicate response');

    // Service worker / session scenarios
    case 'F010': // worker restart between steps
      // Simulate worker termination by throwing a fatal error.
      throw new Error('Injected worker restart failure');
    case 'F011': // stale session ID
      // Return a dummy stale identifier that downstream code will reject.
      // Here we simply throw to trigger error handling.
      throw new Error('Injected stale session ID');
    case 'F012': // timeout in step
      // Return a promise that never resolves – but for test speed we reject after delay.
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('Injected step timeout')), 0);
      }) as any;

    // ML pipeline scenarios
    case 'F020': // OCR failure
      throw new Error('Injected OCR failure');
    case 'F021': // NER failure
      throw new Error('Injected NER failure');
    case 'F022': // Face detector failure
      throw new Error('Injected face detection failure');
    case 'F023': // malformed ML output
      // Return an object that violates expected schema.
      return { malformed: true } as any;
    case 'F024': // malformed coordinates
      return { boxes: [{ x: NaN, y: Infinity, w: -1, h: -1 }] } as any;
    case 'F025': // fusion conflict
      // Simulate contradictory findings – we simply throw.
      throw new Error('Injected fusion conflict');

    // Privacy / gate scenarios
    case 'F030': // forged receipt
      throw new Error('Injected forged receipt');
    case 'F031': // stale receipt
      throw new Error('Injected stale receipt');
    case 'F032': // mutated sealed package
      throw new Error('Injected mutated sealed package');
    case 'F033': // missing receipt
      throw new Error('Injected missing receipt');
    case 'F034': // digest mismatch
      throw new Error('Injected receipt digest mismatch');

    // Planner scenarios
    case 'F040': // malformed plan JSON
      throw new Error('Injected malformed planner output');
    case 'F041': // unknown action
      throw new Error('Injected unknown planner action');
    case 'F042': // missing target
      throw new Error('Injected planner missing target');
    case 'F043': // raw PII in action args
      throw new Error('Injected raw PII in planner args');
    case 'F044': // unsafe URL
      throw new Error('Injected unsafe URL in planner');
    case 'F045': // planner timeout
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('Injected planner timeout')), 0);
      }) as any;

    // Executor scenarios
    case 'F050': // stale element
      throw new Error('Injected stale element error');
    case 'F051': // hidden element
      throw new Error('Injected hidden element error');
    case 'F052': // occluded element
      throw new Error('Injected occluded element error');
    case 'F053': // no‑op click
      // Return success but with no observable change – caller will verify.
      return undefined as any;
    case 'F054': // select no‑match
      throw new Error('Injected select no‑match error');
    case 'F055': // partial fill
      // Simulate partial fill by returning partially filled data structure.
      return { filled: false } as any;

    // Human handoff scenarios
    case 'F060': // cancellation while waiting_human
      throw new Error('Injected cancellation during waiting_human');
    case 'F061': // duplicate human response
      throw new Error('Injected duplicate human response');
    case 'F062': // stale human response
      throw new Error('Injected stale human response');

    default:
      // Unknown injection – run normal logic.
      return fn();
  }
}
