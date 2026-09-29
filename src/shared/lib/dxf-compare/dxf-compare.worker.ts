import { compareDigests, digestDxf } from './dxf-compare';
import type { CompareRequest, CompareResponse } from './messages';

// Разбор двух чертежей по 17 МБ — секунды: в потоке страницы он заморозил бы интерфейс и
// кнопку «Отменить». Прогресс: первая половина — исходный чертёж, вторая — результат.
addEventListener('message', (event: MessageEvent<CompareRequest>) => {
  const post = (message: CompareResponse) => {
    postMessage(message);
  };
  const source = digestDxf(new Uint8Array(event.data.source), (done, total) => {
    post({ kind: 'progress', value: done / total / 2 });
  });
  const result = digestDxf(new Uint8Array(event.data.result), (done, total) => {
    post({ kind: 'progress', value: 0.5 + done / total / 2 });
  });
  post({ kind: 'done', comparison: compareDigests(source, result) });
});
