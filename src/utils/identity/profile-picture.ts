/** Shared upload/retention limits. Base64 expands three bytes to four characters. */
export const MAX_PROFILE_PICTURE_FILE_BYTES = 500 * 1024;
// Includes the data-URL media-type header in addition to the encoded payload.
export const MAX_PROFILE_PICTURE_DATA_URL_CHARS =
  4 * Math.ceil(MAX_PROFILE_PICTURE_FILE_BYTES / 3) + 1024;

export function isProfilePictureTooLarge(dataUrl: string | null | undefined): boolean {
  return !!dataUrl && dataUrl.length > MAX_PROFILE_PICTURE_DATA_URL_CHARS;
}
