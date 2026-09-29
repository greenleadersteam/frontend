import type { DxfComparison } from './dxf-compare';
import type { CompareRequest, CompareResponse } from './messages';

type CompareOptions = { signal: AbortSignal; onProgress: (value: number) => void };

// Сравнение в Web Worker. Отмена останавливает воркер сразу, посреди разбора; результат — null.
export async function compareDxfFiles(
  source: Blob,
  result: Blob,
  { signal, onProgress }: CompareOptions,
): Promise<DxfComparison | null> {
  const request: CompareRequest = {
    source: await source.arrayBuffer(),
    result: await result.arrayBuffer(),
  };
  if (signal.aborted) return null;
  const worker = new Worker(new URL('./dxf-compare.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<DxfComparison | null>((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      stop();
      resolve(null);
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.addEventListener('message', (event: MessageEvent<CompareResponse>) => {
      if (event.data.kind === 'progress') {
        onProgress(event.data.value);
        return;
      }
      stop();
      resolve(event.data.comparison);
    });
    worker.addEventListener('error', (event) => {
      stop();
      reject(new Error(event.message));
    });
    // Буферы передаются воркеру, а не копируются: у страницы они больше не нужны.
    worker.postMessage(request, [request.source, request.result]);
  });
}
