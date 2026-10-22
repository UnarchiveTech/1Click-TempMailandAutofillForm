import { toMs } from '@/utils/time/time.js';
import type { Email } from '@/utils/types.js';

type Attachment = NonNullable<Email['attachments']>[number];

export interface LibraryAttachment {
  key: string;
  inbox: string;
  message: Email;
  attachment: Attachment | null;
  fileType: string;
  searchText: string;
  archived: boolean;
}

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function attachmentFileType(attachment: Attachment): string {
  const mime =
    typeof attachment.mimeType === 'string'
      ? attachment.mimeType.split(';', 1)[0].trim().toLowerCase()
      : '';
  const extension =
    typeof attachment.filename === 'string'
      ? attachment.filename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase()
      : undefined;
  // Generic provider MIME values convey less than a known filename extension.
  if (mime && mime !== 'application/octet-stream') return mime;
  return extension ? (EXTENSION_MIME[extension] ?? `.${extension}`) : mime;
}

export function attachmentTypeLabel(fileType: string): string {
  const extension = Object.entries(EXTENSION_MIME).find(([, mime]) => mime === fileType)?.[0];
  return extension ? extension.toUpperCase() : fileType;
}

/** User-initiated navigation only; never fetch remote files while indexing. */
export function attachmentDownloadUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * An on-demand index of existing mailbox metadata, not a second persisted copy.
 * IDs are scoped to the inbox: provider IDs can repeat in different mailboxes.
 * Active bags win over archived duplicates, preserving an older manifest when
 * a newer list-only response has no manifest. Deleted messages never resurface.
 */
export function buildAttachmentLibrary(
  storedEmails: Record<string, Email[]>,
  archivedEmails: Record<string, Email[]>
): LibraryAttachment[] {
  const messages = new Map<string, { inbox: string; message: Email; archived: boolean }>();
  for (const [bags, archived] of [
    [archivedEmails, true],
    [storedEmails, false],
  ] as const) {
    for (const [inbox, bag] of Object.entries(bags)) {
      for (const message of bag) {
        const key = JSON.stringify([inbox.toLowerCase(), message.id]);
        const previous = messages.get(key);
        const attachments =
          Array.isArray(message.attachments) && message.attachments.length > 0
            ? message.attachments
            : previous?.message.attachments;
        messages.set(key, {
          inbox,
          message: { ...previous?.message, ...message, attachments, original_inbox: inbox },
          archived: archived || message.local_archived === true || message.archived === true,
        });
      }
    }
  }
  const entries: LibraryAttachment[] = [];
  for (const [messageKey, { inbox, message, archived }] of messages) {
    if (message.local_deleted) continue;
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const manifest = attachments.filter(
      (attachment) => attachment && typeof attachment === 'object'
    );
    const items: Array<Attachment | null> =
      manifest.length > 0 ? manifest : message.hasAttachment ? [null] : [];
    items.forEach((attachment, index) => {
      const fileType = attachment ? attachmentFileType(attachment) : '';
      entries.push({
        key: JSON.stringify([messageKey, attachment?.partNumber ?? '', index]),
        inbox,
        message,
        attachment,
        fileType,
        archived,
        searchText: [
          attachment?.filename,
          fileType,
          message.from,
          message.from_name,
          message.subject,
          inbox,
        ]
          .filter((value) => typeof value === 'string')
          .join('\n')
          .normalize('NFKC')
          .toLowerCase(),
      });
    });
  }
  return entries.sort(
    (a, b) =>
      toMs(b.message.received_at) - toMs(a.message.received_at) || a.key.localeCompare(b.key)
  );
}

export function filterAttachmentLibrary(
  entries: readonly LibraryAttachment[],
  query: string,
  fileType = '',
  inbox = ''
): LibraryAttachment[] {
  const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(
    (entry) =>
      (!fileType || entry.fileType === fileType) &&
      (!inbox || entry.inbox.toLowerCase() === inbox.toLowerCase()) &&
      terms.every((term) => entry.searchText.includes(term))
  );
}
