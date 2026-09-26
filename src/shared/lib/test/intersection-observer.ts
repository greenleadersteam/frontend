import { vi } from 'vitest';

// jsdom не реализует IntersectionObserver. Заглушка запоминает наблюдателей, а enterViewport
// сообщает им, что все наблюдаемые элементы попали в область видимости, — так тест
// управляет ленивой загрузкой.
const observers = new Set<MockIntersectionObserver>();

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  private readonly targets = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  enter(): void {
    // useInViewport читает только isIntersecting, остальные поля записи ему не нужны.
    const entries = [...this.targets].map(
      (target) =>
        ({ target, isIntersecting: true, intersectionRatio: 1 }) as IntersectionObserverEntry,
    );
    // Заглушка передаёт себя под типом браузерного наблюдателя: колбэку нужен только он сам.
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
  }
}

export function installIntersectionObserver(): void {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
}

export function enterViewport(): void {
  for (const observer of observers) observer.enter();
}
