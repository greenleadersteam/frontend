import { setupServer } from 'msw/node';

import { handlers } from './handlers';

export { resetMockDb } from './db';

export const server = setupServer(...handlers);
