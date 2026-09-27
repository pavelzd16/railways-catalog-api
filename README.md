<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Product search description

`Product.descriptionTags` is an optional text field used by the storefront for the product's `<meta name="description">`. The admin label is «Тэги для поиска». It is separate from the visible `description` and is returned with product data.

Product create/update requests accept `descriptionTags` as a string. Leading and trailing whitespace is trimmed; an empty value or `null` clears the field. Omitting it from an update preserves the saved value. A missing value on creation is stored as `NULL`. The storefront falls back to its generated description when this field is empty.

The product listing's `search` parameter also matches `descriptionTags`, alongside the title, SKU and GOST. Matching uses a case-insensitive substring and respects the selected filters and pagination. The storefront header search and catalog search use this same endpoint.

Deploy the API before the updated storefront. With the target database configured in `DATABASE_URL`, run:

```sh
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
npm run start:prod
```

Migration `20260912200000_product_description_tags` adds the nullable column without changing existing descriptions. The Docker build generates the client; the container startup applies migrations before starting the API.

`npm run test:regression` covers field validation, creation, updates, clearing and preservation of existing product data.

## Ограничение попыток входа

`POST /api/auth/login` допускает до пяти неверных паролей для одного логина за 15 минут. Первые четыре ошибки возвращают `401` и `attemptsRemaining`. Пятая ошибка блокирует вход на 15 минут и возвращает `429`, `retryAfter` в секундах и заголовок `Retry-After`. Повторные запросы не продлевают блокировку. Успешный вход до блокировки сбрасывает счётчик; после истечения срока вход снова доступен.

Счётчик привязан к нормализованному логину, а не к IP прокси. Неизвестные логины обрабатываются так же. В PostgreSQL сохраняются только хеш логина, число ошибок и срок действия. Транзакционная блокировка защищает от параллельных запросов; перезапуск или несколько экземпляров API не сбрасывают лимит. Истёкшие записи удаляются раз в минуту.

Перед запуском обновлённого API применить миграцию `20260927150000_login_attempts` командой `npx prisma migrate deploy`, сгенерировать Prisma Client и пересобрать приложение. Docker выполняет эти шаги штатно. Фронтенд использует `retryAfter` для таймера; ограничение действует и при прямом обращении к API.

`npm run test:regression` проверяет порог, сброс, истечение срока, независимость логинов, параллельные запросы, валидацию и HTTP-заголовок.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
