import { screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithTheme } from '@/shared/lib/test';

import { MapView } from './map-view';

// В jsdom нет WebGL (getContext → null), как на рабочем месте без GPU: конструктор MapLibre
// бросает GPUInitializationError. Компонент не должен пропустить её наружу.
test('без WebGL — сообщает потребителю, а не падает', async () => {
  const onUnavailable = vi.fn();
  const onReady = vi.fn();
  const onBasemapResolved = vi.fn();

  renderWithTheme(
    <MapView
      bounds={[37.64, 55.75, 37.65, 55.76]}
      padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      label="План посадок"
      basemapVisible
      onReady={onReady}
      onBasemapResolved={onBasemapResolved}
      onUnavailable={onUnavailable}
    />,
  );

  await waitFor(() => {
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
  expect(onReady).not.toHaveBeenCalled();
  // В тестах basemapUrl: null — подложка выключена конфигом.
  expect(onBasemapResolved).toHaveBeenCalledWith(false);
  expect(screen.getByText('Подложка не загружена')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Приблизить' })).toBeDisabled();
});
