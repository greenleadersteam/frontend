import type { DxfComparison } from './dxf-compare';

export type CompareRequest = { source: ArrayBuffer; result: ArrayBuffer };

export type CompareResponse =
  { kind: 'progress'; value: number } | { kind: 'done'; comparison: DxfComparison };
