import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

// Типы плагина ссылаются на @steiger/toolkit, но плагин не объявляет его в зависимостях,
// поэтому для typescript-eslint конфиг плагина — error type.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- см. комментарий выше
export default defineConfig([
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- см. комментарий выше
  ...fsd.configs.recommended,
]);
