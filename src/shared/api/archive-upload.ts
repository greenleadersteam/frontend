import { getRuntimeConfig } from '@/shared/config';

import { type AppError, toAppError } from './app-error';

export type UploadProgress = { sentBytes: number; totalBytes: number };

export type ArchiveUploadResult =
  { kind: 'accepted' } | { kind: 'failed'; error: AppError } | { kind: 'aborted' };

type UploadArchiveOptions = {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// XHR, а не fetch: fetch не сообщает о прогрессе отправки. Промис не отклоняется —
// все исходы, включая отмену, приходят как ArchiveUploadResult.
export function uploadArchive(
  projectId: string,
  archive: File,
  { onProgress, signal }: UploadArchiveOptions = {},
): Promise<ArchiveUploadResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }

    const xhr = new XMLHttpRequest();
    const settle = (result: ArchiveUploadResult) => {
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    // Исход фиксируется сразу, не дожидаясь события abort: перехватчик MSW его не отправляет,
    // а повторный resolve промиса ничего не меняет.
    function abort() {
      xhr.abort();
      settle({ kind: 'aborted' });
    }

    const baseUrl = getRuntimeConfig().apiBaseUrl.replace(/\/$/, '');
    xhr.open('POST', `${baseUrl}/projects/${encodeURIComponent(projectId)}/upload`);
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.setRequestHeader('Accept', 'application/json');
    // Заголовки допускают только ISO-8859-1, а имя архива обычно кириллическое.
    xhr.setRequestHeader('X-Upload-Filename', encodeURIComponent(archive.name));

    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.({
        sentBytes: event.loaded,
        totalBytes: event.lengthComputable ? event.total : archive.size,
      });
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle({ kind: 'accepted' });
        return;
      }
      settle({
        kind: 'failed',
        error: toAppError({ status: xhr.status, data: parseBody(xhr.responseText) }),
      });
    });
    xhr.addEventListener('error', () => {
      settle({ kind: 'failed', error: { kind: 'network' } });
    });

    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(archive);
  });
}
