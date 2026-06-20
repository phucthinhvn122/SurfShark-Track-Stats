// apps/telegram-worker/src/generate-session.ts
//
// One-time helper: log in interactively and print a StringSession.
// Run locally: `pnpm tsx apps/telegram-worker/src/generate-session.ts`
// Then store the output (encrypted) as TG_SESSION / settings.telegramSession.
//
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH!;

(async () => {
  const rl = readline.createInterface({ input, output });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => rl.question('Phone (intl format): '),
    password: async () => rl.question('2FA password (blank if none): '),
    phoneCode: async () => rl.question('Login code: '),
    onError: (e) => console.error(e),
  });
  console.log('\n=== SAVE THIS SESSION STRING (encrypt before storing) ===\n');
  console.log(client.session.save());
  await client.disconnect();
  await rl.close();
  process.exit(0);
})();
