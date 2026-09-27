import { describe, expect, test } from 'vitest';

import { projectFileName } from './file-name';

describe('projectFileName', () => {
  test.each([
    ['Сквер на Покровке', 'Сквер на Покровке.dxf'],
    ['Улица Маросейка, 7/9', 'Улица Маросейка, 7_9.dxf'],
    ['Этап 1: проект', 'Этап 1_ проект.dxf'],
    ['a\\b*c?d"e<f>g|h', 'a_b_c_d_e_f_g_h.dxf'],
    ['  двойные   пробелы\tи табуляция  ', 'двойные пробелы и табуляция.dxf'],
    ['Точка в конце.', 'Точка в конце.dxf'],
    ['...', 'план посадок.dxf'],
    ['', 'план посадок.dxf'],
  ])('%j → %j', (name, fileName) => {
    expect(projectFileName(name, '.dxf')).toBe(fileName);
  });

  test('управляющие символы заменяются', () => {
    expect(projectFileName('a\u0000b\u001Fc\u007Fd', '.dxf')).toBe('a_b_c_d.dxf');
  });

  test('длинное название — до 100 символов, с хвостом ведомости в пределах 255 байт', () => {
    const fileName = projectFileName('Ж'.repeat(300), ' — ведомость посадок.csv');

    expect(fileName).toBe(`${'Ж'.repeat(100)} — ведомость посадок.csv`);
    expect(new TextEncoder().encode(fileName).length).toBeLessThanOrEqual(255);
  });
});
