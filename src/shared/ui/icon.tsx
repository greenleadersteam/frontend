import type { Icon as TablerIcon } from '@tabler/icons-react';
import type { JSX } from 'react';

type IconProps = {
  icon: TablerIcon;
  size?: 20 | 24;
  // Акцентная иконка — цвет главного действия; по умолчанию — роль иконок.
  accent?: boolean;
};

// У @tabler/icons-react нет контекста умолчаний, поэтому толщина линии, размер и цвет
// из design.md задаются здесь. Иконка без подписи декоративна: смысл несёт текст рядом.
export function Icon({
  icon: TablerIconComponent,
  size = 20,
  accent = false,
}: IconProps): JSX.Element {
  return (
    <TablerIconComponent
      stroke={1.5}
      size={size}
      color={accent ? 'var(--app-accent)' : 'var(--app-icon)'}
      aria-hidden
    />
  );
}
