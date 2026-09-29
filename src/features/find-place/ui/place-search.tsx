import { ActionIcon, Combobox, Text, TextInput, useCombobox } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { type JSX, useRef, useState } from 'react';

import { BASEMAP_BOUNDS, getRuntimeConfig } from '@/shared/config';
import { Icon } from '@/shared/ui';

import { type Place, useLazyGeocodeQuery } from '../api/geocode';
import { COORDINATES_EXAMPLE, parseQuery } from '../lib/parse-coordinates';
import type { PlaceTarget } from '../lib/show-place';

type PlaceSearchProps = {
  onPick: (target: PlaceTarget) => void;
  className?: string;
};

// Обе карты с поиском не уходят за охват подложки Москвы: место за ним карта не покажет.
const [WEST, SOUTH, EAST, NORTH] = BASEMAP_BOUNDS;
const onMap = (lat: number, lon: number) =>
  lon >= WEST && lon <= EAST && lat >= SOUTH && lat <= NORTH;

const targetOf = (place: Place): PlaceTarget =>
  place.bounds === null
    ? { kind: 'point', lat: place.lat, lon: place.lon }
    : { kind: 'bounds', bounds: place.bounds };

// Поиск места для карты: координаты разбираются в браузере и работают всегда, адрес — через
// геокодер из конфига контура, если он там есть.
export function PlaceSearch({ onPick, className }: PlaceSearchProps): JSX.Element {
  const { geocoder } = getRuntimeConfig();
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
    },
  });
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [geocode, { isFetching }] = useLazyGeocodeQuery();
  // Адрес последнего запроса: ответ на запрос, после которого строку уже изменили, не
  // открывает список под новым текстом.
  const requested = useRef<string | null>(null);

  const search = () => {
    const query = parseQuery(value);
    switch (query.kind) {
      case 'coordinates':
        if (!onMap(query.lat, query.lon)) {
          setProblem(
            `Точка за пределами карты Москвы. Проверьте порядок: сначала широта, потом долгота, например ${COORDINATES_EXAMPLE}.`,
          );
          return;
        }
        setProblem(null);
        combobox.closeDropdown();
        onPick({ kind: 'point', lat: query.lat, lon: query.lon });
        return;
      case 'error':
        setProblem(query.message);
        return;
      case 'address': {
        if (geocoder === null) {
          setProblem(
            `Поиск по адресу не настроен. Введите координаты, например ${COORDINATES_EXAMPLE}.`,
          );
          return;
        }
        // Политика Nominatim — не больше запроса в секунду: поиск только по Enter или кнопке,
        // пока идёт запрос, новый не уходит, а повтор того же адреса берётся из кеша.
        if (isFetching) {
          setProblem('Идёт поиск. Дождитесь ответа и нажмите Enter ещё раз.');
          return;
        }
        setProblem(null);
        requested.current = query.text;
        geocode({ url: geocoder.url, text: query.text }, true)
          .unwrap()
          .then((found) => {
            if (requested.current !== query.text) return;
            const shown = found.filter((place) => onMap(place.lat, place.lon));
            setPlaces(shown);
            if (shown.length === 0) {
              setProblem(
                found.length === 0
                  ? 'Ничего не нашлось. Уточните адрес или введите координаты.'
                  : 'В Москве такого адреса не нашлось. Уточните адрес или введите координаты.',
              );
              return;
            }
            combobox.openDropdown();
          })
          .catch(() => {
            if (requested.current !== query.text) return;
            setProblem('Поиск по адресу не ответил. Проверьте сеть или введите координаты.');
          });
        return;
      }
      default: {
        const unexpected: never = query;
        return unexpected;
      }
    }
  };

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(id) => {
        const place = places.find((candidate) => candidate.id === id);
        if (place === undefined) return;
        setValue(place.name);
        combobox.closeDropdown();
        onPick(targetOf(place));
      }}
    >
      <Combobox.Target>
        <TextInput
          className={className}
          aria-label="Найти место на карте"
          placeholder={
            geocoder === null
              ? `Координаты, например ${COORDINATES_EXAMPLE}`
              : `Адрес или координаты, например ${COORDINATES_EXAMPLE}`
          }
          value={value}
          error={problem}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setProblem(null);
            requested.current = null;
            combobox.closeDropdown();
          }}
          onKeyDown={(event) => {
            // Enter по выбранному результату обрабатывает Combobox; иначе Enter — это поиск.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (combobox.dropdownOpened && combobox.getSelectedOptionIndex() !== -1) return;
            event.preventDefault();
            search();
          }}
          rightSection={
            <ActionIcon variant="subtle" aria-label="Найти" loading={isFetching} onClick={search}>
              <Icon icon={IconSearch} />
            </ActionIcon>
          }
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options aria-label="Найденные места">
          {places.map((place) => (
            <Combobox.Option key={place.id} value={place.id}>
              {place.name}
            </Combobox.Option>
          ))}
        </Combobox.Options>
        {geocoder !== null && (
          <Combobox.Footer>
            <Text size="xs" c="dimmed">
              {geocoder.attribution}
            </Text>
          </Combobox.Footer>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}
