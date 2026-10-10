export function createReplayReviewConfig(href) {
  const page = new URL(href);
  const recordingId = page.searchParams.get('recording') || '';
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) throw new Error('回放链接无效');
  const source = new URL('independent-replay.html', page);
  source.searchParams.set('recording', recordingId);
  source.searchParams.set('review', '1');
  const commentsApi = new URL(`independent/api/recordings/${encodeURIComponent(recordingId)}/comments`, page);
  return { recordingId, title: '游玩回放与批注', sourceUrl: source.href, commentsApi: commentsApi.href, apiName: '__SP_REPLAY_REVIEW__', duration: 0 };
}

export function reviewCommentHref(href, time, commentId) {
  const link = new URL(href);
  link.searchParams.set('t', String(Math.max(0, Number(time) || 0)));
  link.searchParams.set('comment', String(commentId));
  return link.href;
}

export function createReplayCommentAnchor({ time, selector, framePath = [], tag, textExcerpt = '', rect = null, viewport }) {
  return {
    time_sec: Number(Math.max(0, Number(time) || 0).toFixed(3)),
    selector,
    frame_path: [...framePath],
    tag,
    text_excerpt: String(textExcerpt).trim().slice(0, 240),
    rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    viewport: { width: Math.max(1, Number(viewport?.width) || 1), height: Math.max(1, Number(viewport?.height) || 1) },
  };
}
