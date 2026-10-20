import {spawnSync} from 'node:child_process';

// Child processes use subscription authentication only. Never print auth output.
export function subscriptionEnv(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^(OPENAI_|ANTHROPIC|CODEX_API_KEY|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_API_KEY|AWS_|AZURE_OPENAI_|GOOGLE_|GEMINI_)/i.test(key)));
}

// Claude additionally drops inherited Claude Code overrides (model/subagent/provider knobs) and Node injection.
// HOME/USER/PATH/CLAUDE_CONFIG_DIR stay so the normal macOS keychain login keeps working.
// Auto memory is explicitly disabled after filtering so inherited values cannot re-enable it.
export function claudeEnv(source = process.env) {
  return {...Object.fromEntries(Object.entries(subscriptionEnv(source)).filter(([key]) =>
    !/^(CLAUDE_CODE_|CLAUDE_AGENT_SDK|NODE_OPTIONS$)/i.test(key))), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'};
}

export function checkSubscription(provider, run = spawnSync) {
  const env = provider === 'claude' ? claudeEnv() : subscriptionEnv();
  const help = run(provider, ['--help'], {encoding:'utf8', env, timeout:15000});
  if (help.status !== 0) throw Error(`${provider} CLIをインストールし、本人ログインしてください`);
  if (provider === 'codex') {
    const auth = run('codex', ['login','status'], {encoding:'utf8',env,timeout:15000});
    if (auth.status !== 0 || !/logged in using chatgpt/i.test(auth.stdout + auth.stderr))
      throw Error('CodexはChatGPT契約によるログインが必要です。APIキー認証では実行しません');
    const execHelp = run('codex', ['exec','--help'], {encoding:'utf8',env,timeout:15000});
    if (!/--ignore-user-config/.test(execHelp.stdout))
      throw Error('Codex CLIを更新してください（--ignore-user-config対応版が必要です）');
  } else {
    for (const flag of ['--tools','--json-schema','--strict-mcp-config','--no-session-persistence'])
      if (!help.stdout.includes(flag)) throw Error('Claude Codeを更新してください（安全なJSON実行オプションが必要です）');
    const auth = run('claude', ['auth','status','--json'], {encoding:'utf8',env,timeout:15000});
    let status;
    try { status = JSON.parse(auth.stdout); } catch { /* Fail closed. */ }
    if (auth.status !== 0 || status?.loggedIn !== true ||
        !['claude.ai','oauth'].includes(status.authMethod) || !status.subscriptionType)
      throw Error('Claude CodeはClaude契約による本人ログインが必要です。API認証では実行しません');
  }
  return env;
}

export function codexArgs({output, schema, reviewBase}) {
  const args = ['exec','--ephemeral','--ignore-user-config','--sandbox','read-only',
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',
    '-c','web_search="disabled"','--disable','hooks','--disable','apps',
    '--disable','plugins','--disable','browser_use','--disable','computer_use',
    '--disable','image_generation','--disable','multi_agent_v2',
    '--output-last-message',output];
  if (reviewBase) return [...args,'review','--base',reviewBase];
  return [...args,'--skip-git-repo-check','--disable','shell_tool','--disable','unified_exec',
    '--output-schema',schema,'-'];
}
