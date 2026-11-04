// Global Skills turn one operator's event into another operator's payoff.
// Adds 48 trigger/payoff combinations to the existing 10 rankable Skills.
// The 72 themed collectibles remain a separate pool in the same UI.
const triggers=[
 ['cast','协奏','skillStart','干员施放技能'],
 ['redeploy','接力','redeploy','干员再部署'],
 ['reload','装填','reloaded','干员装填弹药'],
 ['summon','回响','summonSpawned','干员召唤单位入场'],
 ['frozen','霜纹','statusApplied','干员使敌人冻结','frozen'],
 ['stun','震荡','statusApplied','干员使敌人晕眩','stun'],
 ['block','壁垒','blocked','干员开始阻挡敌人'],
 ['kill','凯旋','kill','干员击倒敌人'],
];
const payoffs=[
 ['charge','共鸣',[.5,1,1.5,2],'为技力比例最低的1名其他干员充能0.5/1/1.5/2'],
 ['redeploy','换防',[.5,1,1.5,2],'使1名其他干员当前再部署时间减少0.5/1/1.5/2秒'],
 ['growth','战歌',[.01,.02,.03,.04],'使攻击最低的1名其他干员攻击永久+1/2/3/4%（本场，可叠加）'],
 ['heal','援护',[.25,.5,.75,1],'立即治疗生命比例最低的1名其他干员，回复触发者25/50/75/100%攻击力的生命'],
 ['shield','护阵',[80,160,240,320],'使生命比例最低的1名其他干员获得80/160/240/320点屏障'],
 ['ammo','弹链',[1,1,2,2],'为弹药比例最低的1名其他干员补充1/1/2/2发弹药'],
];
export const LINKED_SKILLS=Object.freeze(triggers.flatMap(([trigger,prefix,event,when,status])=>payoffs.map(([effect,suffix,amount,text])=>({
 id:`strategy_link_${trigger}_${effect}`,name:`${prefix}·${suffix}`,startingStar:1,prices:[5,10,20,40],
 description:`你的${when}时，${text}。每2秒最多触发一次。`,
 icon:{kind:'GIcon',name:effect==='shield'?'shield':effect==='heal'?'heart':effect==='ammo'?'crosshair':'bolt'},
 battle:{kind:'linkedTrigger',event,status:status??null,effect,amountByStar:amount,cooldown:2},
 sourceRef:{file:'shared/assault/global-skill-pool.js',pointer:`/${trigger}/${effect}`},
}))));
