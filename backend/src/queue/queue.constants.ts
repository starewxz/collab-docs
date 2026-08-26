/**
 * Central registry of BullMQ queue names. Feature modules register against
 * these names with BullModule.registerQueue() when they add processors —
 * no queue here has a processor yet.
 */
export enum QueueName {
  SEARCH_INDEX = 'search-index',
  NOTIFICATIONS = 'notifications',
  BILLING_WEBHOOKS = 'billing-webhooks',
  PAGE_REVALIDATION = 'page-revalidation',
  DOCUMENT_SNAPSHOTS = 'document-snapshots',
}
