// Время на то, чтобы браузер начал сохранение, прежде чем объектный URL освободится:
// Firefox читает blob после возврата из click().
const REVOKE_DELAY_MS = 10_000;

// Сохранение файла, собранного в браузере или полученного fetch: временная ссылка на Blob.
export function saveFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}
