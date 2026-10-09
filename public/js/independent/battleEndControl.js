/** A finished replay must always expose a route back to preparation. */
export function battleEndControl(done, finished = false) {
  return done
    ? { label: finished ? '查看结算' : '继续备战', action: 'close', disabled: false }
    : { label: '跳到结尾', action: 'seek', disabled: false };
}
