'use strict';
// Usage: node scripts/codex-smoke.cjs C:\absolute\codex.exe C:\absolute\vault
// Handshake/account/catalog only: never initiates login or an inference turn.
const { CodexClient } = require('../src/codex-client.cjs');
async function main() {
  const [, , executable, cwd] = process.argv;
  const client = new CodexClient({ executable, cwd, timeoutMs: 20000 });
  try {
    const initialized = await client.connect();
    const account = await client.readAccount();
    const models = await client.listModels();
    console.log(JSON.stringify({
      connected: true, server: initialized.userAgent,
      loggedIn: Boolean(account.account), accountType: account.account?.type ?? null,
      modelCount: models.data?.length ?? 0
    }, null, 2));
  } finally { client.close(); }
}
main().catch(() => { console.error('Codex connection smoke check failed. Check executable, CLI setup and login in Codex.'); process.exitCode = 1; });
