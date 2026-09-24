// Письма о заказах и заявках с сайта. Здесь только текст письма — отправка в NotifyService.

// По этой метке пользователь раскладывает письма сайта фильтром в папку,
// а свои письма самому себе — нет. Менять только вместе с фильтром в почте.
export const SUBJECT_TAG = '[Сайт traer.ru]';

export interface LetterFile {
  filename: string;
  content: Buffer;
}

export interface Letter {
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: LetterFile[];
}

interface Client {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  comment?: string | null;
}

export interface OrderForLetter extends Client {
  orderNumber: string;
  totalAmount: number;
  items: {
    productTitle: string;
    productSku: string;
    quantity: number;
    price: number;
  }[];
}

export interface RequestForLetter extends Client {
  product?: { title: string; sku: string } | null;
  service?: { title: string } | null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

// Имя клиента попадает в тему: перевод строки там — чужой заголовок письма.
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\s/g, ' ')} руб.`;
}

function subject(what: string, client: Client): string {
  return oneLine(`${SUBJECT_TAG} ${what} — ${client.name}, ${client.phone}`);
}

function clientRows(client: Client): [string, string, string?][] {
  const phoneHref = `tel:${client.phone.replace(/[^\d+]/g, '')}`;
  const rows: [string, string, string?][] = [
    ['Клиент', client.name],
    ['Телефон', client.phone, phoneHref],
  ];
  if (client.email)
    rows.push(['Почта', client.email, `mailto:${client.email}`]);
  if (client.address) rows.push(['Адрес доставки', client.address]);
  if (client.comment) rows.push(['Комментарий', client.comment]);
  return rows;
}

function rowsText(rows: [string, string, string?][]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join('\n');
}

function rowsHtml(rows: [string, string, string?][]): string {
  const cells = rows
    .map(([label, value, href]) => {
      const shown = escapeHtml(value).replace(/\n/g, '<br>');
      const body = href ? `<a href="${escapeHtml(href)}">${shown}</a>` : shown;
      return `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${label}</td><td style="padding:4px 0">${body}</td></tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;margin:12px 0">${cells}</table>`;
}

function adminLink(siteUrl: string | undefined, path: string, label: string) {
  if (!siteUrl) return { text: '', html: '' };
  const url = `${siteUrl}${path}`;
  return {
    text: `\n\n${label}: ${url}`,
    html: `<p><a href="${escapeHtml(url)}">${label}</a></p>`,
  };
}

function page(heading: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222"><h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(heading)}</h2>${body}</div>`;
}

export function orderLetter(order: OrderForLetter, siteUrl?: string): Letter {
  const heading = `Новый заказ № ${order.orderNumber} с сайта`;
  const client = clientRows(order);

  // Каталог почти весь «по запросу»: у такой позиции цена 0, сумму оценивает менеджер.
  const lines = order.items.map((item, index) => {
    const priced = item.price > 0;
    const price = priced
      ? `${money(item.price)} × ${item.quantity} = ${money(item.price * item.quantity)}`
      : 'цена по запросу';
    return {
      text: `${index + 1}. ${item.productTitle} (арт. ${item.productSku}) — кол-во: ${item.quantity}, ${price}`,
      html: `<tr><td style="padding:4px 8px;border:1px solid #ddd">${index + 1}</td><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(item.productTitle)}</td><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(item.productSku)}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${item.quantity}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${priced ? money(item.price) : 'по запросу'}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${priced ? money(item.price * item.quantity) : '—'}</td></tr>`,
    };
  });

  const someOnRequest = order.items.some((item) => !(item.price > 0));
  const total =
    order.totalAmount > 0
      ? `${money(order.totalAmount)}${someOnRequest ? ' (без позиций с ценой по запросу)' : ''}`
      : 'по запросу';
  const link = adminLink(siteUrl, '/admin/orders', 'Все заказы в админке');

  const head = `<tr>${['№', 'Наименование', 'Артикул', 'Кол-во', 'Цена', 'Сумма'].map((title) => `<th style="padding:4px 8px;border:1px solid #ddd;background:#f4f4f4;text-align:left">${title}</th>`).join('')}</tr>`;

  return {
    subject: subject(`Заказ № ${order.orderNumber}`, order),
    text:
      `${heading}\n\n${rowsText(client)}\n\nТовары:\n` +
      lines.map((line) => line.text).join('\n') +
      `\n\nИтого: ${total}` +
      link.text,
    html: page(
      heading,
      rowsHtml(client) +
        `<table style="border-collapse:collapse">${head}${lines.map((line) => line.html).join('')}</table>` +
        `<p><b>Итого: ${escapeHtml(total)}</b></p>` +
        link.html,
    ),
    replyTo: order.email ?? undefined,
  };
}

export function requestLetter(
  request: RequestForLetter,
  siteUrl: string | undefined,
  files: LetterFile[],
): Letter {
  const heading = 'Новая заявка с сайта';
  const rows = clientRows(request);
  if (request.product) {
    rows.unshift([
      'Товар',
      `${request.product.title} (арт. ${request.product.sku})`,
    ]);
  }
  if (request.service) rows.unshift(['Услуга', request.service.title]);
  if (files.length > 0) {
    rows.push([
      'Файлы',
      `${files.map((file) => file.filename).join(', ')} — приложены к письму`,
    ]);
  }

  const topic = request.service?.title ?? request.product?.title;
  const link = adminLink(siteUrl, '/admin/requests', 'Все заявки в админке');

  return {
    subject: subject(topic ? `Заявка: ${topic}` : 'Заявка', request),
    text: `${heading}\n\n${rowsText(rows)}${link.text}`,
    html: page(heading, rowsHtml(rows) + link.html),
    replyTo: request.email ?? undefined,
    attachments: files,
  };
}
