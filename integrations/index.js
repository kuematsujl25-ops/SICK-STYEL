/** Explicit adapters only: no remote calls until an official authorized adapter is configured.
 * Each adapter returns daily normalized metrics. Never send tokens to the browser.
 */
export const manualAdapter = Object.freeze({
  mode: 'manual',
  async fetchMetrics() { throw new Error('手入力モードです。公式APIの認可済みアダプターを設定してください。'); },
});
export function createIntegrations({ amazon = manualAdapter, instagram = manualAdapter } = {}) {
  for (const adapter of [amazon, instagram]) {
    if (typeof adapter.fetchMetrics !== 'function') throw new TypeError('fetchMetrics adapter required');
  }
  return { amazon, instagram };
}
