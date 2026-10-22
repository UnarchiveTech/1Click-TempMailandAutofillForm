/**
 * The display stand-ins `mapEmailsForDisplay` needs, resolved in the active
 * locale.
 *
 * The mapper itself lives in the background graph (the WebMCP tools import it),
 * so it may only import the minimal background dictionaries - it cannot look a
 * key up for a UI render. It therefore *requires* these three strings instead of
 * defaulting to English, and every list-painting caller resolves them here, so
 * the mailbox list shows the locale's own wording rather than English.
 */
import type { DisplayLabels } from '@/utils/email/email-mapper.js';
import { t } from '@/utils/i18n/i18n-utils.js';

export async function displayLabels(): Promise<DisplayLabels> {
  return {
    unknownSender: await t('common.unknown'),
    noSubject: await t('notifications.noSubject'),
    invalidMessage: await t('notifications.invalidMessage'),
  };
}
