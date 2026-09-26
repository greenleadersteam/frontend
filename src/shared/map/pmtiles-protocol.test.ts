import { beforeEach, describe, expect, test, vi } from 'vitest';

const addProtocol = vi.fn();
const getHeader = vi.fn<() => Promise<object>>();
const added: string[] = [];

vi.mock('maplibre-gl', () => ({ addProtocol }));
vi.mock('pmtiles', () => ({
  PMTiles: class {
    source: { getKey: () => string };
    constructor(url: string) {
      this.source = { getKey: () => url };
    }
    getHeader = getHeader;
  },
  Protocol: class {
    tile = vi.fn();
    add(archive: { source: { getKey: () => string } }) {
      added.push(archive.source.getKey());
    }
  },
}));

// Состояние протокола живёт в модуле, поэтому каждый тест получает свежий экземпляр модуля.
const load = async () => {
  vi.resetModules();
  return import('./pmtiles-protocol');
};

beforeEach(() => {
  addProtocol.mockClear();
  getHeader.mockReset();
  added.length = 0;
});

describe('openBasemapArchive', () => {
  test('протокол регистрируется один раз, сколько бы карт ни открывалось', async () => {
    getHeader.mockResolvedValue({});
    const { openBasemapArchive } = await load();

    await openBasemapArchive('/basemap/moscow.pmtiles');
    await openBasemapArchive('/basemap/moscow.pmtiles');

    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol).toHaveBeenCalledWith('pmtiles', expect.any(Function));
  });

  test('адрес архива — абсолютный от origin', async () => {
    getHeader.mockResolvedValue({});
    const { openBasemapArchive } = await load();

    await expect(openBasemapArchive('/basemap/moscow.pmtiles')).resolves.toBe(
      `${location.origin}/basemap/moscow.pmtiles`,
    );
    expect(added).toEqual([`${location.origin}/basemap/moscow.pmtiles`]);
  });

  test('архив не читается (404) — подложки нет, протокол не регистрируется', async () => {
    getHeader.mockRejectedValue(new Error('404'));
    const { openBasemapArchive } = await load();

    await expect(openBasemapArchive('/basemap/moscow.pmtiles')).resolves.toBeNull();
    expect(addProtocol).not.toHaveBeenCalled();
  });

  test('basemapUrl: null — подложка выключена без запроса', async () => {
    const { openBasemapArchive } = await load();

    await expect(openBasemapArchive(null)).resolves.toBeNull();
    expect(getHeader).not.toHaveBeenCalled();
  });
});
