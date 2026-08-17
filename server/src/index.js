import 'dotenv/config';
import { createApp } from './app.js';
import { logger } from './logger.js';

const port = process.env.PORT || 4000;
const app = createApp();

app.listen(port, () => {
  logger.info({ port }, 'server listening');
});
