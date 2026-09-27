import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Link, Outlet, type RouteObject } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { buildZip, renderWithProviders, resetMockDb, server } from '@/shared/lib/test';

import { ProjectNewPage } from './project-new-page';

const routes: RouteObject[] = [
  {
    element: (
      <>
        <Link to="/">Уйти к списку</Link>
        <Outlet />
      </>
    ),
    children: [
      { path: '/projects/new', Component: ProjectNewPage },
      { path: '/projects/:projectId', element: <h1>Страница проекта</h1> },
      { path: '/', element: <h1>Список проектов</h1> },
    ],
  },
];

const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';
const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';
const FAILED_ID = 'b4e6a8c0d2f44b7e9a1c3e5b7d9f0a2c';
const AMBIGUOUS_ID = 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d';

const renderWizard = (path = '/projects/new') => renderWithProviders(routes, path);

// Файл «больше лимита» без выделения 100 МБ: проверка смотрит только на size.
const oversized = (name: string) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: MAX_ARCHIVE_BYTES + 1 });
  return file;
};

const zip = (name = 'site.zip', entries = [{ name: 'ГП/Генплан.dxf', data: '0\nSECTION' }]) =>
  new File([buildZip(entries)], name);

const fileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('Нет поля выбора файла');
  return input;
};

async function fillDetails(name = 'Сквер на Покровке') {
  await userEvent.type(await screen.findByLabelText(/Название проекта/), name);
  await userEvent.click(screen.getByRole('button', { name: 'Далее: файлы' }));
}

async function chooseArchive(file: File | File[]) {
  await userEvent.upload(fileInput(), file);
}

const dxf = (name: string) => new File(['0\nSECTION'], name);

const countRequests = (method: string, pattern: RegExp) => {
  const counter = { count: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && pattern.test(new URL(request.url).pathname)) {
      counter.count += 1;
    }
  });
  return counter;
};

// Обработка в моке идёт по реальному времени: дальше — фейковые таймеры и Date.
const useFakeTime = () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
};
const advance = async (ms: number) => {
  for (let passed = 0; passed < ms; passed += 1000) {
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
};
// Этапы и итог дублируются в невидимом объявлении для скринридера: ищем видимый текст
// в разметке шага (этапы — span в списке, итог — абзац).
const waitForText = (text: string | RegExp, selector = 'span, p') =>
  act(() => vi.waitFor(() => screen.getByText(text, { selector }), { timeout: 5000 }));

afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
});

describe('шаг «Описание»', () => {
  test('название обязательно: ошибка при попытке перейти дальше и после ухода из поля', async () => {
    renderWizard();

    await userEvent.click(await screen.findByRole('button', { name: 'Далее: файлы' }));
    expect(await screen.findByText('Укажите название проекта.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Название проекта/), 'x'.repeat(121));
    await userEvent.tab();
    expect(await screen.findByText(/^Название — не длиннее 120 символов/)).toBeInTheDocument();
    expect(screen.getByText('121/120')).toBeInTheDocument();
  });

  test('проект на этом шаге не создаётся', async () => {
    const created = countRequests('POST', /^\/api\/projects$/);
    renderWizard();

    await fillDetails();

    expect(await screen.findByText(/Перетащите ZIP, один или несколько DXF/)).toBeInTheDocument();
    expect(created.count).toBe(0);
  });
});

describe('шаг «Файлы»', () => {
  test.each([
    ['не ZIP и не DXF', () => new File(['x'], 'site.rar'), /^Сервер читает только DXF/],
    [
      'ZIP вместе с DXF',
      () => [zip(), new File(['0\nSECTION'], 'Сети.dxf')],
      /^Загрузите либо один ZIP, либо отдельные файлы\.$/,
    ],
    ['больше лимита', () => oversized('big.zip'), /^Архив больше 100 МБ\./],
    [
      'не ZIP по содержимому',
      () => new File(['%PDF-1.7'], 'site.zip'),
      /^Файл не похож на архив ZIP/,
    ],
    ['пустой архив', () => zip('site.zip', []), /^Архив пустой\./],
    [
      'нет DXF',
      () => zip('site.zip', [{ name: 'readme.txt', data: '' }]),
      /^В архиве нет чертежей DXF/,
    ],
  ])('%s — ошибка под зоной загрузки', async (_, file, message) => {
    renderWizard();
    await fillDetails();

    await chooseArchive(file());

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Загрузить и обработать' })).toBeDisabled();
  });

  test('сводка: имя, размер, число файлов, DXF по-русски из CP866, остальные свёрнуты', async () => {
    renderWizard();
    await fillDetails();

    await chooseArchive(
      new File(
        [
          buildZip([
            { name: 'ГП/Генплан.dxf', encoding: 'cp866' },
            { name: 'ГП/Генплан_изм2.dxf', encoding: 'cp866' },
            { name: 'Сети/пояснение.txt', encoding: 'cp866' },
          ]),
        ],
        'подоснова.zip',
      ),
    );

    expect(await screen.findByText('подоснова.zip')).toBeInTheDocument();
    expect(screen.getByText(/, 3 файла$/)).toBeInTheDocument();
    expect(screen.getByText('ГП/Генплан.dxf')).toBeInTheDocument();
    expect(screen.getByText('ГП/Генплан_изм2.dxf')).toBeInTheDocument();
    expect(screen.getByText(/^Сервис сам определит главный чертёж/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать все файлы (3)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('отдельные DXF', () => {
  test('три DXF: сводка как у архива, главный чертёж сервис выберет сам', async () => {
    renderWizard();
    await fillDetails();

    await chooseArchive([dxf('Генплан.dxf'), dxf('Сети.DXF'), dxf('Благоустройство.dxf')]);

    expect(await screen.findByText('Выбранные файлы')).toBeInTheDocument();
    expect(screen.getByText(/, 3 файла$/)).toBeInTheDocument();
    expect(screen.getByText('Генплан.dxf')).toBeInTheDocument();
    expect(screen.getByText('Сети.dxf')).toBeInTheDocument();
    expect(screen.getByText('Благоустройство.dxf')).toBeInTheDocument();
    expect(screen.getByText(/^Сервис сам определит главный чертёж/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Заменить файлы' })).toBeInTheDocument();
  });

  test('один DXF: браузер собирает ZIP, сервер принимает его как архив', async () => {
    const bodies: { filename: string | null; signature: number }[] = [];
    server.events.on('request:start', ({ request }) => {
      if (!request.url.endsWith('/upload')) return;
      void request
        .clone()
        .arrayBuffer()
        .then((body) => {
          bodies.push({
            filename: request.headers.get('X-Upload-Filename'),
            signature: new DataView(body).getUint32(0, true),
          });
        });
    });
    renderWizard();
    await fillDetails();
    await chooseArchive(dxf('Генплан.dxf'));
    expect(await screen.findByText('Выбранные файлы')).toBeInTheDocument();
    expect(screen.queryByText(/^Сервис сам определит главный чертёж/)).not.toBeInTheDocument();

    useFakeTime();
    resetMockDb();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await waitForText('В очереди');
    await advance(20_000);

    expect(screen.getByText('План посадок готов', { selector: 'p' })).toBeInTheDocument();
    expect(bodies).toEqual([
      { filename: encodeURIComponent('Генплан.zip'), signature: 0x04034b50 },
    ]);
  });
});

describe('загрузка и обработка', () => {
  test('создание → загрузка → обработка → готово', async () => {
    const created = countRequests('POST', /^\/api\/projects$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    useFakeTime();
    resetMockDb();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await waitForText('В очереди');
    expect(created.count).toBe(1);

    await advance(20_000);

    expect(screen.getByText('План посадок готов', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('обработано за 15 с')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть проект' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/projects\/[0-9a-f]{32}$/),
    );
  });

  test('отмена загрузки: запрос прерван, проект удалён, файл сохранён', async () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () => new Promise<never>(() => undefined)),
    );
    const deleted = countRequests('DELETE', /^\/api\/projects\/[0-9a-f]{32}$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip('pokrovka.zip'));

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Отменить загрузку' }));

    expect(await screen.findByText('pokrovka.zip')).toBeInTheDocument();
    expect(deleted.count).toBe(1);
    expect(screen.getByRole('button', { name: 'Загрузить и обработать' })).toBeEnabled();
  });

  test('429 — сообщение и повтор в тот же проект, без автоповтора', async () => {
    server.use(
      http.post(
        '/api/projects/:projectId/upload',
        () => HttpResponse.json({ detail: 'Too many' }, { status: 429 }),
        { once: true },
      ),
    );
    const created = countRequests('POST', /^\/api\/projects$/);
    const uploads = countRequests('POST', /\/upload$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    expect(
      await screen.findByText('Сервер обрабатывает другие проекты. Повторите через минуту.'),
    ).toBeInTheDocument();
    expect(uploads.count).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));

    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
    expect(uploads.count).toBe(2);
    expect(created.count).toBe(1);
  });

  // Сценарий через две обработки идёт около 5 с — ровно предел по умолчанию: под нагрузкой
  // он выходил за предел, а продолжение прерванного теста роняло следующие тесты файла.
  test('несколько главных чертежей → выбор → /runs → готово', async () => {
    const runs = countRequests('POST', /\/runs$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip('ambiguous.zip'));

    useFakeTime();
    resetMockDb();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await waitForText('В очереди');
    await advance(10_000);

    const choice = 'В архиве несколько главных чертежей. Выберите нужный.';
    expect(screen.getByRole('radiogroup', { name: choice })).toBeInTheDocument();
    // Подпись выбора без role="alert": скринридеру ошибку объявляет aria-live.
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(choice);
    fireEvent.click(screen.getByRole('radio', { name: 'Генплан_корр.dxf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить обработку' }));
    await waitForText('В очереди');
    expect(runs.count).toBe(1);

    await advance(20_000);
    expect(screen.getByText('План посадок готов', { selector: 'p' })).toBeInTheDocument();
  }, 15_000);

  test('ошибка обработки → «Загрузить другой архив» → шаг «Файлы» с тем же проектом', async () => {
    // Подделано только время мока: опрос и user-event идут на настоящих таймерах.
    vi.useFakeTimers({ toFake: ['Date'] });
    resetMockDb();
    const created = countRequests('POST', /^\/api\/projects$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip('nodxf.zip'));
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await screen.findByRole('list', { name: 'Этапы обработки' });

    vi.setSystemTime(Date.now() + 10_000);
    expect(
      await screen.findByText(/^В архиве нет файлов DXF\./, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить другой архив' }));
    await chooseArchive(zip('second.zip'));

    // Ответ о проекте после второй загрузки придерживается: в кэше пока прошлая ошибка,
    // и шаг обработки не должен показать её снова.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/projects/:projectId', async () => {
        await gate;
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить и обработать' }));
    expect(await screen.findByLabelText('Загрузка состояния проекта')).toBeInTheDocument();
    expect(screen.queryByText(/^В архиве нет файлов DXF\./)).not.toBeInTheDocument();

    act(() => {
      release();
    });
    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
    expect(created.count).toBe(1);
  }, 10_000);
});

describe('загрузка: отказы и отмена', () => {
  test('413 — возврат к выбору архива с объяснением', async () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () =>
        HttpResponse.json({ detail: 'Upload exceeds the maximum allowed size' }, { status: 413 }),
      ),
    );
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByText(/^Архив больше 100 МБ\./)).toBeInTheDocument();
    expect(screen.getByText(/Перетащите ZIP, один или несколько DXF/)).toBeInTheDocument();
  });

  test('отмена, пока проект создаётся: созданный проект удаляется, загрузка не начинается', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/projects', async () => {
        await gate;
      }),
    );
    const uploads = countRequests('POST', /\/upload$/);
    const deleted = countRequests('DELETE', /^\/api\/projects\/[0-9a-f]{32}$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Отменить загрузку' }));
    act(() => {
      release();
    });

    await waitFor(() => {
      expect(deleted.count).toBe(1);
    });
    expect(uploads.count).toBe(0);
    expect(screen.getByRole('button', { name: 'Загрузить и обработать' })).toBeEnabled();
  });

  test('ошибка запроса проекта после 202 — сообщение и повтор', async () => {
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    server.use(
      http.get('/api/projects/:projectId', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
  });
});

describe('409 на загрузку', () => {
  const conflictOnUpload = () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () =>
        HttpResponse.json(
          { detail: "Project is not uploadable in status 'parsing'" },
          { status: 409 },
        ),
      ),
    );
  };

  test('обработку уже запустили — мастер показывает её этапы', async () => {
    conflictOnUpload();
    server.use(
      http.get('/api/projects/:projectId', ({ params }) =>
        HttpResponse.json({
          id: params.projectId,
          name: 'Сквер',
          description: null,
          created_at: '2026-09-20T10:00:00Z',
          updated_at: '2026-09-20T10:00:00Z',
          status: 'parsing',
          job: { stage: 'parsing', progress_pct: 10, started_at: '2026-09-20T10:00:00Z' },
        }),
      ),
    );
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
    expect(screen.queryByText(/Перетащите ZIP, один или несколько DXF/)).not.toBeInTheDocument();
  });

  test('сбой запроса проекта после 409 — его причина и повтор, а не конфликт', async () => {
    conflictOnUpload();
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    server.use(
      http.get('/api/projects/:projectId', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
  });

  test('обработки нет — текст ошибки, «Открыть проект» и «К списку проектов», проект не удаляется', async () => {
    conflictOnUpload();
    const deleted = countRequests('DELETE', /^\/api\/projects\//);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());

    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Архив не принят: состояние проекта изменилось/,
    );
    expect(screen.getByRole('link', { name: 'Открыть проект' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/projects\/[0-9a-f]{32}$/),
    );
    expect(screen.getByRole('link', { name: 'К списку проектов' })).toHaveAttribute('href', '/');

    // Уход без подтверждения: проект уже не черновик мастера.
    await userEvent.click(screen.getByRole('link', { name: 'К списку проектов' }));
    expect(await screen.findByRole('heading', { name: 'Список проектов' })).toBeInTheDocument();
    expect(deleted.count).toBe(0);
  });
});

describe('уход со страницы', () => {
  test('до ответа 202 — подтверждение и удаление проекта', async () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () => new Promise<never>(() => undefined)),
    );
    const deleted = countRequests('DELETE', /^\/api\/projects\/[0-9a-f]{32}$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await screen.findByRole('button', { name: 'Отменить загрузку' });

    await userEvent.click(screen.getByRole('link', { name: 'Уйти к списку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уйти со страницы?' });
    expect(dialog).toHaveTextContent('Загрузка будет прервана, а проект удалён. Уйти со страницы?');
    await userEvent.click(screen.getByRole('button', { name: 'Уйти' }));

    expect(await screen.findByRole('heading', { name: 'Список проектов' })).toBeInTheDocument();
    expect(deleted.count).toBe(1);
  });

  test('закрытие вкладки до ответа 202 — keepalive-запрос удаления проекта', async () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () => new Promise<never>(() => undefined)),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await screen.findByRole('button', { name: 'Отменить загрузку' });

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/projects\/[0-9a-f]{32}$/),
      { method: 'DELETE', keepalive: true },
    );
    fetchSpy.mockClear();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('уход во время загрузки в существующий проект прерывает загрузку', async () => {
    server.use(
      http.post('/api/projects/:projectId/upload', () => new Promise<never>(() => undefined)),
    );
    // Перехватчик XHR в MSW не передаёт отмену в request.signal: смотрим на сам вызов abort.
    const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort');
    renderWizard(`/projects/new?project=${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Улица Маросейка, 7–9' });
    await chooseArchive(zip());
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await screen.findByRole('button', { name: 'Отменить загрузку' });
    expect(abort).not.toHaveBeenCalled();

    // Проект существовал до мастера: подтверждения нет, но загрузка не должна идти в фоне.
    await userEvent.click(screen.getByRole('link', { name: 'Уйти к списку' }));

    expect(await screen.findByRole('heading', { name: 'Список проектов' })).toBeInTheDocument();
    expect(abort).toHaveBeenCalled();
    abort.mockRestore();
  });

  test('уход, пока проект создаётся: проект удаляется, загрузка не начинается', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/projects', async () => {
        await gate;
      }),
    );
    const uploads = countRequests('POST', /\/upload$/);
    const deleted = countRequests('DELETE', /^\/api\/projects\/[0-9a-f]{32}$/);
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    await userEvent.click(screen.getByRole('link', { name: 'Уйти к списку' }));
    await screen.findByRole('heading', { name: 'Список проектов' });
    act(() => {
      release();
    });

    await waitFor(() => {
      expect(deleted.count).toBe(1);
    });
    expect(uploads.count).toBe(0);
  });

  test('после ответа 202 — уход без подтверждения', async () => {
    renderWizard();
    await fillDetails();
    await chooseArchive(zip());
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));
    await screen.findByRole('list', { name: 'Этапы обработки' });

    await userEvent.click(screen.getByRole('link', { name: 'Уйти к списку' }));

    expect(await screen.findByRole('heading', { name: 'Список проектов' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('существующий проект', () => {
  test('без архива — мастер со шага «Файлы», в заголовке название проекта', async () => {
    renderWizard(`/projects/new?project=${DRAFT_ID}`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Улица Маросейка, 7–9' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Перетащите ZIP, один или несколько DXF/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назад' })).not.toBeInTheDocument();
  });

  test('проект с ошибкой — новый архив, прошлая ошибка из кэша не показывается', async () => {
    renderWizard(`/projects/new?project=${FAILED_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Улица Большая Ордынка, 21' });
    await chooseArchive(zip('ordynka_fixed.zip'));

    // Страница подписана на проект, поэтому после 202 его кэш не удаляется, а обновляется:
    // пока ответ придерживается, в кэше — прошлая ошибка обработки.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/projects/:projectId', async () => {
        await gate;
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

    expect(await screen.findByLabelText('Загрузка состояния проекта')).toBeInTheDocument();
    expect(screen.queryByText(/^Архив повреждён или это не ZIP/)).not.toBeInTheDocument();
    act(() => {
      release();
    });
    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
  });

  test('несколько главных чертежей — мастер сразу на выборе, выбор ведёт к /runs', async () => {
    const runs = countRequests('POST', /\/runs$/);
    renderWizard(`/projects/new?project=${AMBIGUOUS_ID}`);

    expect(
      await screen.findByRole('radiogroup', {
        name: 'В архиве несколько главных чертежей. Выберите нужный.',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Перетащите ZIP, один или несколько DXF/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'ГП/Генплан.dxf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить обработку' }));

    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
    expect(runs.count).toBe(1);
  });

  test('ошибка запроса проекта — сообщение и повтор', async () => {
    server.use(
      http.get('/api/projects/:projectId', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );
    renderWizard(`/projects/new?project=${DRAFT_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Улица Маросейка, 7–9' }),
    ).toBeInTheDocument();
  });

  test('готовый проект — загрузка недоступна, ссылка на список', async () => {
    renderWizard(`/projects/new?project=${READY_ID}`);

    expect(
      await screen.findByText(/^В этот проект сейчас нельзя загрузить архив/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К списку проектов' })).toHaveAttribute('href', '/');
  });

  test.each(['unknown', 'bad%20id'])('проект «%s» не найден', async (id) => {
    renderWizard(`/projects/new?project=${id}`);

    expect(await screen.findByText(/^Проект не найден/)).toBeInTheDocument();
  });
});
