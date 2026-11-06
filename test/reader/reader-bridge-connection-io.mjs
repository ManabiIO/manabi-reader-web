/** @license BSD-3-Clause */
// Only the account/HTTP boundary is replaced. Source validation, ZIP decoding,
// comparison, connection transactions and recovery run their production code.
export class IntegrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function captureLibraryOperation(owner) {
  return globalThis.readerConnectionTransport.scope(owner);
}
export function request(...args) {
  return globalThis.readerConnectionTransport.request(...args);
}
