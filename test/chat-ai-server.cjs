// Explicit test-only provider override. Never imported by the application.
require('reflect-metadata');
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/src/app.module');
const { GigaChatClient } = require('../dist/src/chat/ai/gigachat.client');
const { ChatNotifications } = require('../dist/src/chat/chat.notifications');

async function boot(port = 0) {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test'))
    throw Error('AI tests require an isolated loopback *_test database');
  const provider = {
    configured: true, model: 'test-only-provider',
    async complete(messages) {
      const question = messages.at(-1).content;
      return `Тестовый ответ ИИ: ${question}\nК рельсам могут понадобиться накладки и стыковые болты. Профиль и комплектность уточнит менеджер. Какой объём нужен?`;
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GigaChatClient).useValue(provider)
    .overrideProvider(ChatNotifications).useValue({})
    .compile();
  const app = module.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });
  await app.listen(port, '127.0.0.1');
  return { app, provider, url: await app.getUrl() };
}
module.exports = { boot };
if (require.main === module) boot(4191).then(({ url }) => console.log(`TEST PROVIDER ONLY: ${url}`)).catch(error => { console.error(error); process.exitCode = 1; });
