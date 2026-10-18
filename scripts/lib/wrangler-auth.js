// whoami --json emits one JSON document, including pretty-printed multiline output.
// Never include CLI output in errors: authenticated responses contain account details.
export function requireWranglerLogin(result) {
  let account;
  try {
    account = JSON.parse(result.stdout);
  } catch {
    throw Error('Wranglerの認証確認を実行できません。npx --no-install wrangler --version で依存関係とCLI起動を確認してください');
  }
  if (result.error || result.signal || typeof account?.loggedIn !== 'boolean')
    throw Error('Wranglerの認証確認が完了していません。CLIの状態を確認してください');
  if (!account.loggedIn)
    throw Error('Cloudflare本人ログインが必要です。Macで npx wrangler login を実行してください');
  if (result.status !== 0)
    throw Error('Wranglerの認証確認が失敗しました。CLIの状態を確認してください');
}
