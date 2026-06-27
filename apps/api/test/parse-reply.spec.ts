// apps/api/test/parse-reply.spec.ts
import { parseBotReply } from '../src/key-redeem/telegram/parse-reply';

describe('parseBotReply', () => {
  it('recognises a success reply', () => {
    expect(parseBotReply('✅ Logged in')).toMatchObject({ ok: true, code: 'success' });
  });
  it('recognises an expired reply', () => {
    expect(parseBotReply('Your code is expired')).toMatchObject({ ok: false, code: 'bot_rejected' });
  });
  it('treats unknown text as bot_rejected', () => {
    expect(parseBotReply('🛸 unknown payload')).toMatchObject({ ok: false, code: 'bot_rejected' });
  });
  it('handles empty input', () => {
    expect(parseBotReply('')).toMatchObject({ ok: false, code: 'bot_rejected' });
  });
});
