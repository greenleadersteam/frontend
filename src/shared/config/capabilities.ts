import { currentDataSource } from './data-source';
import { type Capability, getRuntimeConfig } from './runtime-config';

// Умеет ли источник данных функцию сверх базового API. Компоненты не знают о режиме показа:
// в «Демо» моки реализуют весь контракт-предложение, на сервере — только объявленное в конфиге.
// Источник и конфиг не меняются до перезагрузки, поэтому хук не подписывается ни на что.
export function useCapability(name: Capability): boolean {
  return currentDataSource() === 'demo' || getRuntimeConfig().serverCapabilities.includes(name);
}
