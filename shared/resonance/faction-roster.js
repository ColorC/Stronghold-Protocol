/**
 * Faction-season design input. Each faction and combat pact retains the exact
 * natural-member fee multiset and activation thresholds of its cited Set 13
 * template. Native affiliation is checked against the frozen character table.
 * The season is the union of these ten faction rosters (57 distinct operators),
 * not a forced one-to-one reskin of the source game's overlapping origins.
 */
export const factionRoster = Object.freeze([
  { id:'academy', name:'拉特兰', nationId:'laterano', sourceName:'Academy', members:[['送葬人',1],['见行者',2],['隐现',3],['空弦',4],['蕾缪安',5]] },
  { id:'creation', name:'谢拉格', nationId:'kjerag', sourceName:'Automata', members:[['角峰',1],['耶拉',2],['银灰',3],['灵知',3],['圣聆初雪',5]] },
  { id:'sui', name:'炎', nationId:'yan', sourceName:'Black Rose', members:[['九色鹿',1],['惊蛰',2],['仇白',3],['夕',4],['令',5]] },
  { id:'flight', name:'深海猎人', groupId:'abyssal', sourceName:'Firelight', members:[['斯卡蒂',2],['幽灵鲨',3],['歌蕾蒂娅',4]] },
  { id:'resistance', name:'维多利亚', nationId:'victoria', sourceName:'Rebel', members:[['格拉尼',1],['凯瑟琳',1],['谜图',2],['刺玫',2],['哈洛德',3],['号角',4],['焰影苇草',4],['维娜·维多利亚',5]] },
  { id:'risk', name:'叙拉古', nationId:'siracusa', sourceName:'Chem-Baron', members:[['红云',1],['贾维',2],['布洛卡',3],['巫恋',3],['拉普兰德',4],['荒芜拉普兰德',5]] },
  { id:'conqueror', name:'卡西米尔', nationId:'kazimierz', sourceName:'Conqueror', members:[['正义骑士号',1],['砾',1],['流星',2],['瑕光',3],['焰尾',4],['玛恩纳',5]] },
  { id:'rhodes', name:'哥伦比亚', nationId:'columbia', sourceName:'Scrap', members:[['香草',1],['罗比菈塔',1],['雷蛇',2],['梅尔',3],['塞雷娅',4],['多萝西',4],['缪尔赛思',5]] },
  { id:'enforcer', name:'罗德岛', nationId:'rhodes', sourceName:'Enforcer', members:[['调香师',1],['休谟斯',1],['华法琳',2],['寒芒克洛丝',3],['百炼嘉维尔',3],['泥岩',4],['魔王',5]] },
  { id:'experiment', name:'萨尔贡', nationId:'sargon', sourceName:'Experiment', members:[['蜜蜡',1],['艾丝黛尔',2],['泡泡',3],['菲莱',4],['异客',4]] },
]);

export const combatRoster = Object.freeze([
  { id:'arts', name:'术式', sourceName:'Sorcerer', members:['蜜蜡','九色鹿','惊蛰','灵知','巫恋','异客','圣聆初雪'] },
  { id:'logistics', name:'技力协同', sourceName:'Visionary', members:['凯瑟琳','调香师','华法琳','刺玫','哈洛德','焰影苇草','魔王'] },
  { id:'sentinel', name:'坚阵', sourceName:'Sentinel', members:['角峰','香草','雷蛇','贾维','瑕光','塞雷娅','维娜·维多利亚'] },
  { id:'bruiser', name:'重装', sourceName:'Bruiser', members:['格拉尼','休谟斯','艾丝黛尔','幽灵鲨','百炼嘉维尔','泥岩'] },
  { id:'watcher', name:'守望', sourceName:'Watcher', members:['砾','罗比菈塔','斯卡蒂','谜图','泡泡','歌蕾蒂娅'] },
  { id:'ammo', name:'狙击', sourceName:'Sniper', members:['送葬人','流星','隐现','空弦','蕾缪安'] },
  { id:'redeploy', name:'突袭', sourceName:'Ambusher', members:['红云','见行者','仇白','拉普兰德','荒芜拉普兰德'] },
  { id:'dominator', name:'掌控', sourceName:'Dominator', members:['耶拉','梅尔','巫恋','夕','多萝西','令'] },
  { id:'breaker', name:'决斗', sourceName:'Pit Fighter', members:['正义骑士号','休谟斯','斯卡蒂','布洛卡','菲莱','玛恩纳'] },
  { id:'combo', name:'迅击', sourceName:'Quickstriker', members:['谜图','流星','寒芒克洛丝','焰尾'] },
  { id:'artillery', name:'连轰', sourceName:'Artillerist', members:['见行者','艾丝黛尔','银灰','号角'] },
  { id:'formSwap', name:'双形', sourceName:'Form Swapper', members:['银灰','梅尔','夕','缪尔赛思'] },
  { id:'emissary', name:'领军', sourceName:'Emissary', members:['雷蛇','瑕光','号角','塞雷娅'] },
  { id:'family', name:'同袍', sourceName:'Family', members:['香草','罗比菈塔','华法琳'] },
  { id:'holyGun', name:'圣枪', sourceName:'High Roller', members:['蕾缪安'] },
  { id:'armory', name:'铸军', sourceName:'Junker King', members:['维娜·维多利亚'] },
]);

// These source ability hooks are part of the corresponding pact, independent
// of a champion's name or the original season's origin membership.
export const sourceHookAssignments = Object.freeze({
  TFT13_Zyra:'蜜蜡', TFT13_Urgot:'艾丝黛尔', TFT13_NunuWillump:'泡泡',
  TFT13_DrMundo:'菲莱', TFT13_Twitch:'异客', TFT13_Rumble:'维娜·维多利亚',
  TFT13_Lieutenant:'蕾缪安', TFT13_Malzahar:'圣聆初雪', TFT13_LeBlanc:'令',
  TFT13_Tristana:'雷蛇', TFT13_Nami:'瑕光', TFT13_Ambessa:'号角', TFT13_Garen:'塞雷娅',
});
