import { html,Button,useTicker } from '../ui/components.js';

export function ReplayControls({replay,frame,playing,setPlaying,speed,setSpeed,jumpToEnd,onClose}) {
 useTicker(playing?200:0);
 const total=replay?.frames?.length||0;
 const current=Math.min(total,Math.max(0,Number(frame?.current)||0));
 const ended=current>=total;
 return html`<section class="rs-replay-native" role="dialog" aria-label="战斗回放"><b>第 ${replay.round} 场战斗</b><${Button} size="sm" disabled=${ended} onClick=${()=>setPlaying(!playing)}>${ended?'播放结束':playing?'暂停':'继续'}</${Button}>
   <label>速度<select value=${speed} onChange=${e=>setSpeed(Number(e.currentTarget.value))}>${[1,2,4,8].map(x=>html`<option value=${x}>${x}倍</option>`)}</select></label><progress max=${total||1} value=${current} aria-label="回放进度"></progress>
   <${Button} size="sm" onClick=${jumpToEnd}>跳到结算</${Button}><${Button} size="sm" onClick=${onClose}>关闭</${Button}></section>`;
}
