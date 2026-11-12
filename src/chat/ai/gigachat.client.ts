import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class GigaChatClient {
  private token?: { value: string; expiresAt: number };
  private refreshing?: Promise<string>;

  get configured() {
    return (
      process.env.CHAT_AI_ENABLED === 'true' && !!process.env.GIGACHAT_AUTH_KEY
    );
  }

  get model() {
    return process.env.GIGACHAT_MODEL || 'GigaChat-2';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60000)
      return this.token.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await fetch(
        'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${process.env.GIGACHAT_AUTH_KEY}`,
            RqUID: randomUUID(),
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new Error(`GigaChat authorization: HTTP ${response.status}`);
      const data = (await response.json()) as {
        access_token?: string;
        expires_at?: number;
      };
      if (!data.access_token || !Number.isFinite(data.expires_at))
        throw new Error('Invalid GigaChat token response');
      const expiresAt =
        data.expires_at! < 1e12 ? data.expires_at! * 1000 : data.expires_at!;
      if (expiresAt <= Date.now()) throw new Error('Expired GigaChat token');
      this.token = { value: data.access_token, expiresAt };
      return data.access_token;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  async complete(messages: AiMessage[]): Promise<string> {
    if (!this.configured) throw new Error('GigaChat is not configured');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      const response = await fetch(
        'https://api.giga.chat/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            stream: false,
            temperature: 0.3,
            max_tokens: 900,
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (response.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (!response.ok)
        throw new Error(`GigaChat completion: HTTP ${response.status}`);
      const data = (await response.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
      };
      const choice = data.choices?.[0];
      const body = choice?.message?.content?.trim();
      if (choice?.finish_reason !== 'stop' || !body || body.length > 4000)
        throw new Error('GigaChat returned an incomplete or invalid answer');
      return body;
    }
    throw new Error('GigaChat authorization failed');
  }
}
