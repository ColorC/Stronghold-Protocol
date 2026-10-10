export const LAST_COMPLETED_RECORDING_KEY = 'sp:last-completed-recording';

export function prepareNewRecordingUrl(href) {
  const url = new URL(href);
  url.searchParams.delete('recording');
  url.searchParams.set('record', '1');
  return url;
}

export function initialPlaybackId(href, storage) {
  const url = new URL(href);
  return url.searchParams.get('recording') || storage?.getItem(LAST_COMPLETED_RECORDING_KEY) || '';
}
