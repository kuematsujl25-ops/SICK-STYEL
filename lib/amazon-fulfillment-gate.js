// Deliberately no live adapter or environment-variable escape hatch.
export const fulfillmentReadiness = () => ({
 enabled: false, mode: 'blocked', code: 'AMAZON_FULFILLMENT_NOT_APPROVED',
 error: '配送先閲覧・発送通知は未有効化です。管理者の個別ID/MFA、Amazonロール、暗号化・削除・監査の確認が必要です。',
 requirements: ['individual-admin-identity-and-mfa', 'restricted-address-role-grant', 'shipment-role-grant', 'encryption-and-key-management', 'retention-and-deletion', 'pii-free-audit', 'durable-transactional-outbox-and-reconciliation', 'explicit-production-approval'],
});
