import type { Icon as TablerIcon } from '@tabler/icons-react';
import type { JSX } from 'react';

type IconProps = {
  icon: TablerIcon;
  size?: 20 | 24;
  // Роль цвета: иконка по умолчанию, акцент главного действия, ошибка.
  tone?: 'icon' | 'accent' | 'error';
  // Подпись для иконки, которая сама несёт смысл (статус без текста рядом).
  label?: string;
};

const TONE_COLORS = {
  icon: 'var(--app-icon)',
  accent: 'var(--app-accent)',
  error: 'var(--app-error)',
} as const;

// У @tabler/icons-react нет контекста умолчаний, поэтому толщина линии, размер и цвет
// из design.md задаются здесь. Иконка без подписи декоративна: смысл несёт текст рядом.
export function Icon({
  icon: TablerIconComponent,
  size = 20,
  tone = 'icon',
  label,
}: IconProps): JSX.Element {
  return (
    <TablerIconComponent
      stroke={1.5}
      size={size}
      color={TONE_COLORS[tone]}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
}
