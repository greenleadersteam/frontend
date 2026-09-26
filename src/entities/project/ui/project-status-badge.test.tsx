import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { renderWithTheme } from '@/shared/lib/test';

import { STAGE_LABELS, STATE_LABELS } from '../config/labels';
import { ProjectStatusBadge } from './project-status-badge';

// Бейдж — одно-два слова, до 20 символов (design.md, «Бейдж статуса»).
test.each(Object.values({ ...STAGE_LABELS, ...STATE_LABELS }))(
  'подпись «%s» укладывается в 20 символов',
  (label) => {
    expect(label.length).toBeLessThanOrEqual(20);
  },
);

describe('ProjectStatusBadge', () => {
  test.each([
    [{ kind: 'draft' } as const, 'draft', 'Архив не загружен'],
    [{ kind: 'processing', stage: 'parsing' } as const, 'processing', 'Разбор подосновы'],
    [{ kind: 'unknown' } as const, 'processing', 'Обрабатывается'],
    [{ kind: 'ready' } as const, 'ready', 'Готово'],
    [{ kind: 'failed', error: null } as const, 'failed', 'Ошибка обработки'],
  ])('%o — вариант %s, текст «%s»', (state, variant, text) => {
    renderWithTheme(<ProjectStatusBadge state={state} />);

    const badge = screen.getByText(text).closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', variant);
  });

  test('процент этапа — отдельной капсулой справа', () => {
    renderWithTheme(
      <ProjectStatusBadge state={{ kind: 'processing', stage: 'parsing' }} progressPct={40} />,
    );

    const label = screen.getByText('Разбор подосновы');
    const value = label.parentElement?.querySelector('.mantine-Badge-section');
    expect(value?.textContent).toBe('40\u00A0%');
    expect(value).toHaveAttribute('data-position', 'right');
  });

  test('подробность ошибки в бейдж не попадает', () => {
    const error = { code: 'no_dxf_found', message: 'No .dxf files found' } as const;
    renderWithTheme(<ProjectStatusBadge state={{ kind: 'failed', error }} />);

    expect(screen.getByText('Ошибка обработки').parentElement?.textContent).toBe(
      'Ошибка обработки',
    );
  });
});
