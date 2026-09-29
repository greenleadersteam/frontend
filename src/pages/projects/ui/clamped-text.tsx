import { Text, type TextProps, Tooltip } from '@mantine/core';
import { useElementSize, useMergedRef } from '@mantine/hooks';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';

import classes from './project-card.module.css';

type ClampedTextProps = TextProps & {
  lineClamp: number;
  // Полный текст для подсказки, когда строки обрезаны.
  full: string;
  // Внутри уже есть фокусируемый элемент (ссылка): свой tabIndex тексту не нужен.
  focusableInside?: boolean;
  component?: 'p' | 'h2';
  children: ReactNode;
};

// Текст в несколько строк с многоточием. Полный текст — в подсказке, и только если он
// действительно обрезан: подсказка открывается наведением и фокусом с клавиатуры.
export function ClampedText({
  lineClamp,
  full,
  focusableInside = false,
  component = 'p',
  children,
  ...props
}: ClampedTextProps): JSX.Element {
  const { ref: sizeRef, width, height } = useElementSize<HTMLParagraphElement>();
  const element = useRef<HTMLParagraphElement>(null);
  const ref = useMergedRef(sizeRef, element);
  const [shown, setShown] = useState(false);
  const [clipped, setClipped] = useState(false);
  // Обрезку видно только по раскладке: пересчёт при каждом изменении размера карточки.
  useEffect(() => {
    const current = element.current;
    if (current !== null) setClipped(current.scrollHeight > current.clientHeight + 1);
  }, [width, height]);
  const open = () => {
    setShown(clipped);
  };
  const close = () => {
    setShown(false);
  };
  return (
    <Tooltip label={full} multiline opened={shown} classNames={{ tooltip: classes.tooltip }}>
      <Text
        ref={ref}
        component={component}
        lineClamp={lineClamp}
        // Обрезанный текст без ссылки внутри получает фокус, чтобы подсказку открывала и клавиатура.
        tabIndex={clipped && !focusableInside ? 0 : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        {...props}
      >
        {children}
      </Text>
    </Tooltip>
  );
}
