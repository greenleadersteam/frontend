import { addProtocol } from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';

let protocol: Protocol | null = null;

// Протокол один на приложение: он держит кэш заголовков и каталогов архива, и повторная
// регистрация при каждом монтировании карты этот кэш бы сбрасывала.
function pmtilesProtocol(): Protocol {
  if (protocol === null) {
    protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
  }
  return protocol;
}

// Архив проверяется чтением заголовка до создания карты: если файла нет (404), карта
// строится без подложки, а не сыплет ошибками тайлов. Адрес — абсолютный от origin.
export async function openBasemapArchive(path: string | null): Promise<string | null> {
  if (path === null) return null;
  const url = new URL(path, location.origin).href;
  const archive = new PMTiles(url);
  try {
    await archive.getHeader();
  } catch {
    return null;
  }
  pmtilesProtocol().add(archive);
  return url;
}
