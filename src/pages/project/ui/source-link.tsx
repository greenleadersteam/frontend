import { Button } from '@mantine/core';
import type { JSX } from 'react';

// Адрес первоисточника пришёл с сервера: проверяется разбором, а не по префиксу — разрешены
// только http и https (security.md, «Недоверенные данные»). В тексте источника породы адрес
// стоит внутри фразы: берётся первый.
export function sourceUrl(text: string | null): string | null {
  const match = text?.match(/https?:\/\/\S+/)?.[0];
  if (match === undefined) return null;
  // Знак препинания после адреса — часть фразы, а не адреса: «…/Вяз_гладкий, корни: …».
  // Закрывающая скобка остаётся, только если у неё есть парная открывающая.
  const count = (text: string, char: string) => text.split(char).length - 1;
  let candidate = match.replace(/[.,;:!?»”'"]+$/, '');
  while (candidate.endsWith(')') && count(candidate, ')') > count(candidate, '(')) {
    candidate = candidate.slice(0, -1).replace(/[.,;:!?»”'"]+$/, '');
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

type SourceLinkProps = {
  href: string;
  // Что за источник — для скринридера: «Источник нормы: Газопровод».
  label: string;
};

// Первоисточник всегда внешний: новая вкладка без доступа к окну приложения.
export function SourceLink({ href, label }: SourceLinkProps): JSX.Element {
  return (
    <Button
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      variant="subtle"
      size="compact-sm"
      aria-label={label}
    >
      Источник
    </Button>
  );
}
