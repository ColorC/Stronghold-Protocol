import { assets } from '../assets.js';
const FIXED_SKILLS = Object.freeze({
  "char_498_inside:“解决麻烦”": {
    "skillId": "skchr_inside_2",
    "iconId": "skchr_inside_2",
    "url": "/assets/skill/skchr_inside_2.png",
    "name": "“解决麻烦”"
  },
  "char_199_yak:抗寒体质": {
    "skillId": "skchr_yak_2",
    "iconId": "skchr_yak_2",
    "url": "/assets/skill/skchr_yak_2.png",
    "name": "抗寒体质"
  },
  "char_306_leizi:初雷": {
    "skillId": "skchr_leizi_2",
    "iconId": "skchr_leizi_2",
    "url": "/assets/skill/skchr_leizi_2.png",
    "name": "初雷"
  },
  "char_4137_udflow:行动能力剥夺": {
    "skillId": "skchr_udflow_2",
    "iconId": "skchr_udflow_2",
    "url": "/assets/skill/skchr_udflow_2.png",
    "name": "行动能力剥夺"
  },
  "char_494_vendla:荆藤庇荫": {
    "skillId": "skchr_vendla_2",
    "iconId": "skchr_vendla_2",
    "url": "/assets/skill/skchr_vendla_2.png",
    "name": "荆藤庇荫"
  },
  "char_145_prove:狼眼": {
    "skillId": "skchr_prove_1",
    "iconId": "skchr_prove_1",
    "url": "/assets/skill/skchr_prove_1.png",
    "name": "狼眼"
  },
  "char_102_texas:剑雨": {
    "skillId": "skchr_texas_2",
    "iconId": "skchr_texas_2",
    "url": "/assets/skill/skchr_texas_2.png",
    "name": "剑雨"
  },
  "char_4100_caper:乐趣加倍": {
    "skillId": "skchr_caper_2",
    "iconId": "skchr_caper_2",
    "url": "/assets/skill/skchr_caper_2.png",
    "name": "乐趣加倍"
  },
  "char_196_sunbr:备用军粮": {
    "skillId": "skchr_sunbr_1",
    "iconId": "skchr_sunbr_1",
    "url": "/assets/skill/skchr_sunbr_1.png",
    "name": "备用军粮"
  },
  "char_127_estell:舍身突击": {
    "skillId": "skchr_estell_2",
    "iconId": "skchr_estell_2",
    "url": "/assets/skill/skchr_estell_2.png",
    "name": "舍身突击"
  },
  "char_258_podego:孢子扩散": {
    "skillId": "skchr_podego_2",
    "iconId": "skchr_podego_2",
    "url": "/assets/skill/skchr_podego_2.png",
    "name": "孢子扩散"
  },
  "char_253_greyy:静电释放": {
    "skillId": "skchr_greyy_2",
    "iconId": "skchr_greyy_2",
    "url": "/assets/skill/skchr_greyy_2.png",
    "name": "静电释放"
  },
  "char_469_indigo:光影迷宫": {
    "skillId": "skchr_indigo_2",
    "iconId": "skchr_indigo_2",
    "url": "/assets/skill/skchr_indigo_2.png",
    "name": "光影迷宫"
  },
  "char_337_utage:落地斩·破门": {
    "skillId": "skchr_utage_2",
    "iconId": "skchr_utage_2",
    "url": "/assets/skill/skchr_utage_2.png",
    "name": "落地斩·破门"
  },
  "char_496_wildmn:夹枪冲锋": {
    "skillId": "skchr_wildmn_2",
    "iconId": "skchr_wildmn_2",
    "url": "/assets/skill/skchr_wildmn_2.png",
    "name": "夹枪冲锋"
  },
  "char_107_liskam:反击电弧": {
    "skillId": "skchr_liskam_2",
    "iconId": "skchr_liskam_2",
    "url": "/assets/skill/skchr_liskam_2.png",
    "name": "反击电弧"
  },
  "char_279_excu:最终旅程": {
    "skillId": "skchr_excu_2",
    "iconId": "skchr_excu_2",
    "url": "/assets/skill/skchr_excu_2.png",
    "name": "最终旅程"
  },
  "char_108_silent:医疗无人机": {
    "skillId": "skchr_silent_2",
    "iconId": "skchr_silent_2",
    "url": "/assets/skill/skchr_silent_2.png",
    "name": "医疗无人机"
  },
  "char_4122_grabds:乡音沉沉": {
    "skillId": "skchr_grabds_2",
    "iconId": "skchr_grabds_2",
    "url": "/assets/skill/skchr_grabds_2.png",
    "name": "乡音沉沉"
  },
  "char_4114_harold:重症优先": {
    "skillId": "skchr_harold_2",
    "iconId": "skchr_harold_2",
    "url": "/assets/skill/skchr_harold_2.png",
    "name": "重症优先"
  },
  "char_4139_papyrs:巧思乍现": {
    "skillId": "skchr_papyrs_1",
    "iconId": "skchr_papyrs_1",
    "url": "/assets/skill/skchr_papyrs_1.png",
    "name": "巧思乍现"
  },
  "char_143_ghost:肉斩骨断": {
    "skillId": "skchr_ghost_2",
    "iconId": "skchr_ghost_2",
    "url": "/assets/skill/skchr_ghost_2.png",
    "name": "肉斩骨断"
  },
  "char_381_bubble:“挨打”": {
    "skillId": "skchr_bubble_2",
    "iconId": "skchr_bubble_2",
    "url": "/assets/skill/skchr_bubble_2.png",
    "name": "“挨打”"
  },
  "char_491_humus:高效处理": {
    "skillId": "skchr_humus_2",
    "iconId": "skchr_humus_2",
    "url": "/assets/skill/skchr_humus_2.png",
    "name": "高效处理"
  },
  "char_4040_rockr:自负此轭": {
    "skillId": "skchr_rockr_2",
    "iconId": "skchr_rockr_2",
    "url": "/assets/skill/skchr_rockr_2.png",
    "name": "自负此轭"
  },
  "char_4016_kazema:纸艺·双影": {
    "skillId": "skchr_kazema_2",
    "iconId": "skchr_kazema_2",
    "url": "/assets/skill/skchr_kazema_2.png",
    "name": "纸艺·双影"
  },
  "char_237_gravel:鼠群": {
    "skillId": "skchr_gravel_2",
    "iconId": "skchr_gravel_2",
    "url": "/assets/skill/skchr_gravel_2.png",
    "name": "鼠群"
  },
  "char_4191_tippi:紧急赶场通知": {
    "skillId": "skchr_tippi_2",
    "iconId": "skchr_tippi_2",
    "url": "/assets/skill/skchr_tippi_2.png",
    "name": "紧急赶场通知"
  },
  "char_181_flower:精调": {
    "skillId": "skchr_flower_2",
    "iconId": "skchr_flower_2",
    "url": "/assets/skill/skchr_flower_2.png",
    "name": "精调"
  },
  "char_140_whitew:狼魂": {
    "skillId": "skchr_whitew_2",
    "iconId": "skchr_whitew_2",
    "url": "/assets/skill/skchr_whitew_2.png",
    "name": "狼魂"
  },
  "char_4207_branch:生存决心": {
    "skillId": "skchr_branch_2",
    "iconId": "skchr_branch_2",
    "url": "/assets/skill/skchr_branch_2.png",
    "name": "生存决心"
  },
  "char_431_ashlok:专注轰击": {
    "skillId": "skchr_ashlok_2",
    "iconId": "skchr_ashlok_2",
    "url": "/assets/skill/skchr_ashlok_2.png",
    "name": "专注轰击"
  },
  "char_4151_tinman:“大拉里”": {
    "skillId": "skchr_tinman_2",
    "iconId": "skchr_tinman_2",
    "url": "/assets/skill/skchr_tinman_2.png",
    "name": "“大拉里”"
  },
  "char_103_angel:过载模式": {
    "skillId": "skchr_angel_3",
    "iconId": "skchr_angel_3",
    "url": "/assets/skill/skchr_angel_3.png",
    "name": "过载模式"
  },
  "char_294_ayer:浮游刃启动": {
    "skillId": "skchr_ayer_2",
    "iconId": "skchr_ayer_2",
    "url": "/assets/skill/skchr_ayer_2.png",
    "name": "浮游刃启动"
  },
  "char_308_swire:协同作战": {
    "skillId": "skchr_swire_2",
    "iconId": "skchr_swire_2",
    "url": "/assets/skill/skchr_swire_2.png",
    "name": "协同作战"
  },
  "char_1033_swire2:“见面礼”": {
    "skillId": "skchr_swire2_2",
    "iconId": "skchr_swire2_2",
    "url": "/assets/skill/skchr_swire2_2.png",
    "name": "“见面礼”"
  },
  "char_263_skadi:涌潮悲歌": {
    "skillId": "skchr_skadi_3",
    "iconId": "skchr_skadi_3",
    "url": "/assets/skill/skchr_skadi_3.png",
    "name": "涌潮悲歌"
  },
  "char_4148_philae:冥河诅咒": {
    "skillId": "skchr_philae_2",
    "iconId": "skchr_philae_2",
    "url": "/assets/skill/skchr_philae_2.png",
    "name": "冥河诅咒"
  },
  "char_388_mint:聚能涡旋": {
    "skillId": "skchr_mint_2",
    "iconId": "skchr_mint_2",
    "url": "/assets/skill/skchr_mint_2.png",
    "name": "聚能涡旋"
  },
  "char_4079_haini:阻滞性显色剂": {
    "skillId": "skchr_haini_2",
    "iconId": "skchr_haini_2",
    "url": "/assets/skill/skchr_haini_2.png",
    "name": "阻滞性显色剂"
  },
  "char_440_pinecn:电能过载": {
    "skillId": "skchr_pinecn_2",
    "iconId": "skchr_pinecn_2",
    "url": "/assets/skill/skchr_pinecn_2.png",
    "name": "电能过载"
  },
  "char_4211_snhunt:风雪连弩": {
    "skillId": "skchr_snhunt_2",
    "iconId": "skchr_snhunt_2",
    "url": "/assets/skill/skchr_snhunt_2.png",
    "name": "风雪连弩"
  },
  "char_423_blemsh:先贤化身": {
    "skillId": "skchr_blemsh_3",
    "iconId": "skchr_blemsh_3",
    "url": "/assets/skill/skchr_blemsh_3.png",
    "name": "先贤化身"
  },
  "char_4054_malist:神工意匠": {
    "skillId": "skchr_malist_2",
    "iconId": "skchr_malist_2",
    "url": "/assets/skill/skchr_malist_2.png",
    "name": "神工意匠"
  },
  "char_174_slbell:自然震慑": {
    "skillId": "skchr_slbell_2",
    "iconId": "skchr_slbell_2",
    "url": "/assets/skill/skchr_slbell_2.png",
    "name": "自然震慑"
  },
  "char_150_snakek:壳状防御": {
    "skillId": "skchr_snakek_2",
    "iconId": "skchr_snakek_2",
    "url": "/assets/skill/skchr_snakek_2.png",
    "name": "壳状防御"
  },
  "char_126_shotst:碎甲击·扩散": {
    "skillId": "skchr_shotst_2",
    "iconId": "skchr_shotst_2",
    "url": "/assets/skill/skchr_shotst_2.png",
    "name": "碎甲击·扩散"
  },
  "char_4026_vulpis:隐狐之艺": {
    "skillId": "skchr_vulpis_3",
    "iconId": "skchr_vulpis_3",
    "url": "/assets/skill/skchr_vulpis_3.png",
    "name": "隐狐之艺"
  },
  "char_427_vigil:领袖的尊严": {
    "skillId": "skchr_vigil_3",
    "iconId": "skchr_vigil_3",
    "url": "/assets/skill/skchr_vigil_3.png",
    "name": "领袖的尊严"
  },
  "char_4013_kjera:心随意动": {
    "skillId": "skchr_kjera_2",
    "iconId": "skchr_kjera_2",
    "url": "/assets/skill/skchr_kjera_2.png",
    "name": "心随意动"
  },
  "char_332_archet:箭矢·暴风": {
    "skillId": "skchr_archet_3",
    "iconId": "skchr_archet_3",
    "url": "/assets/skill/skchr_archet_3.png",
    "name": "箭矢·暴风"
  },
  "char_4194_rmixer:退休前布道": {
    "skillId": "skchr_rmixer_3",
    "iconId": "skchr_rmixer_3",
    "url": "/assets/skill/skchr_rmixer_3.png",
    "name": "退休前布道"
  },
  "char_213_mostma:序时之匙": {
    "skillId": "skchr_mostma_3",
    "iconId": "skchr_mostma_3",
    "url": "/assets/skill/skchr_mostma_3.png",
    "name": "序时之匙"
  },
  "char_4087_ines:暗夜无明": {
    "skillId": "skchr_ines_2",
    "iconId": "skchr_ines_2",
    "url": "/assets/skill/skchr_ines_2.png",
    "name": "暗夜无明"
  },
  "char_1021_kroos2:封喉": {
    "skillId": "skchr_kroos2_2",
    "iconId": "skchr_kroos2_2",
    "url": "/assets/skill/skchr_kroos2_2.png",
    "name": "封喉"
  },
  "char_222_bpipe:高效冲击": {
    "skillId": "skchr_bpipe_2",
    "iconId": "skchr_bpipe_2",
    "url": "/assets/skill/skchr_bpipe_2.png",
    "name": "高效冲击"
  },
  "char_437_mizuki:囚徒困境": {
    "skillId": "skchr_mizuki_2",
    "iconId": "skchr_mizuki_2",
    "url": "/assets/skill/skchr_mizuki_2.png",
    "name": "囚徒困境"
  },
  "char_446_aroma:小心地滑": {
    "skillId": "skchr_aroma_2",
    "iconId": "skchr_aroma_2",
    "url": "/assets/skill/skchr_aroma_2.png",
    "name": "小心地滑"
  },
  "char_4162_cathy:战火淬炼": {
    "skillId": "skchr_cathy_2",
    "iconId": "skchr_cathy_2",
    "url": "/assets/skill/skchr_cathy_2.png",
    "name": "战火淬炼"
  },
  "char_474_glady:缺水的碎漩狂舞": {
    "skillId": "skchr_glady_3",
    "iconId": "skchr_glady_3",
    "url": "/assets/skill/skchr_glady_3.png",
    "name": "缺水的碎漩狂舞"
  },
  "char_206_gnosis:零度爆发": {
    "skillId": "skchr_gnosis_2",
    "iconId": "skchr_gnosis_2",
    "url": "/assets/skill/skchr_gnosis_2.png",
    "name": "零度爆发"
  },
  "char_373_lionhd:解构与爆破": {
    "skillId": "skchr_lionhd_2",
    "iconId": "skchr_lionhd_2",
    "url": "/assets/skill/skchr_lionhd_2.png",
    "name": "解构与爆破"
  },
  "char_1028_texas2:剑雨滂沱": {
    "skillId": "skchr_texas2_3",
    "iconId": "skchr_texas2_3",
    "url": "/assets/skill/skchr_texas2_3.png",
    "name": "剑雨滂沱"
  },
  "char_136_hsguma:荆棘": {
    "skillId": "skchr_hsguma_2",
    "iconId": "skchr_hsguma_2",
    "url": "/assets/skill/skchr_hsguma_2.png",
    "name": "荆棘"
  },
  "char_311_mudrok:岩崩锤": {
    "skillId": "skchr_mudrok_2",
    "iconId": "skchr_mudrok_2",
    "url": "/assets/skill/skchr_mudrok_2.png",
    "name": "岩崩锤"
  },
  "char_420_flamtl:焰心": {
    "skillId": "skchr_flamtl_3",
    "iconId": "skchr_flamtl_3",
    "url": "/assets/skill/skchr_flamtl_3.png",
    "name": "焰心"
  },
  "char_430_fartth:光羽箭": {
    "skillId": "skchr_fartth_3",
    "iconId": "skchr_fartth_3",
    "url": "/assets/skill/skchr_fartth_3.png",
    "name": "光羽箭"
  },
  "char_128_plosis:脑啡肽": {
    "skillId": "skchr_plosis_2",
    "iconId": "skchr_plosis_2",
    "url": "/assets/skill/skchr_plosis_2.png",
    "name": "脑啡肽"
  },
  "char_172_svrash:真银斩": {
    "skillId": "skchr_svrash_3",
    "iconId": "skchr_svrash_3",
    "url": "/assets/skill/skchr_svrash_3.png",
    "name": "真银斩"
  },
  "char_1026_gvial2:丛林之魂": {
    "skillId": "skchr_gvial2_3",
    "iconId": "skchr_gvial2_3",
    "url": "/assets/skill/skchr_gvial2_3.png",
    "name": "丛林之魂"
  },
  "char_426_billro:沙缚镣锁": {
    "skillId": "skchr_billro_2",
    "iconId": "skchr_billro_2",
    "url": "/assets/skill/skchr_billro_2.png",
    "name": "沙缚镣锁"
  },
  "char_4134_cetsyr:编织重构现世": {
    "skillId": "skchr_cetsyr_3",
    "iconId": "skchr_cetsyr_3",
    "url": "/assets/skill/skchr_cetsyr_3.png",
    "name": "编织重构现世"
  },
  "char_171_bldsk:紧急包扎": {
    "skillId": "skchr_bldsk_1",
    "iconId": "skchr_bldsk_1",
    "url": "/assets/skill/skchr_bldsk_1.png",
    "name": "紧急包扎"
  },
  "char_1032_excu2:近身铳斗": {
    "skillId": "skchr_excu2_2",
    "iconId": "skchr_excu2_2",
    "url": "/assets/skill/skchr_excu2_2.png",
    "name": "近身铳斗"
  },
  "char_4056_titi:旧日绽放": {
    "skillId": "skchr_titi_3",
    "iconId": "skchr_titi_3",
    "url": "/assets/skill/skchr_titi_3.png",
    "name": "旧日绽放"
  },
  "char_1040_blaze2:众恶的焚场": {
    "skillId": "skchr_blaze2_3",
    "iconId": "skchr_blaze2_3",
    "url": "/assets/skill/skchr_blaze2_3.png",
    "name": "众恶的焚场"
  },
  "char_4145_ulpia:必须开辟的通路": {
    "skillId": "skchr_ulpia_3",
    "iconId": "skchr_ulpia_3",
    "url": "/assets/skill/skchr_ulpia_3.png",
    "name": "必须开辟的通路"
  },
  "char_4010_etlchi:灵与欲的惜别": {
    "skillId": "skchr_etlchi_3",
    "iconId": "skchr_etlchi_3",
    "url": "/assets/skill/skchr_etlchi_3.png",
    "name": "灵与欲的惜别"
  },
  "char_350_surtr:黄昏": {
    "skillId": "skchr_surtr_3",
    "iconId": "skchr_surtr_3",
    "url": "/assets/skill/skchr_surtr_3.png",
    "name": "黄昏"
  },
  "char_4039_horn:终极防线": {
    "skillId": "skchr_horn_3",
    "iconId": "skchr_horn_3",
    "url": "/assets/skill/skchr_horn_3.png",
    "name": "终极防线"
  },
  "char_358_lisa:狐火渺然": {
    "skillId": "skchr_lisa_3",
    "iconId": "skchr_lisa_3",
    "url": "/assets/skill/skchr_lisa_3.png",
    "name": "狐火渺然"
  },
  "char_202_demkni:药物配置": {
    "skillId": "skchr_demkni_2",
    "iconId": "skchr_demkni_2",
    "url": "/assets/skill/skchr_demkni_2.png",
    "name": "药物配置"
  },
  "char_2015_dusk:工笔入化": {
    "skillId": "skchr_dusk_1",
    "iconId": "skchr_dusk_1",
    "url": "/assets/skill/skchr_dusk_1.png",
    "name": "工笔入化"
  },
  "char_1023_ghost2:生存的渴望": {
    "skillId": "skchr_ghost2_2",
    "iconId": "skchr_ghost2_2",
    "url": "/assets/skill/skchr_ghost2_2.png",
    "name": "生存的渴望"
  },
  "char_1045_svash2:御敌的锋锐": {
    "skillId": "skchr_svash2_2",
    "iconId": "skchr_svash2_2",
    "url": "/assets/skill/skchr_svash2_2.png",
    "name": "御敌的锋锐"
  },
  "char_1039_thorn2:解构涌潮": {
    "skillId": "skchr_thorn2_2",
    "iconId": "skchr_thorn2_2",
    "url": "/assets/skill/skchr_thorn2_2.png",
    "name": "解构涌潮"
  },
  "char_264_f12yin:横扫架势": {
    "skillId": "skchr_f12yin_2",
    "iconId": "skchr_f12yin_2",
    "url": "/assets/skill/skchr_f12yin_2.png",
    "name": "横扫架势"
  },
  "char_4064_mlynar:未照耀的荣光": {
    "skillId": "skchr_mlynar_3",
    "iconId": "skchr_mlynar_3",
    "url": "/assets/skill/skchr_mlynar_3.png",
    "name": "未照耀的荣光"
  },
  "char_291_aglina:秘杖·反重力模式": {
    "skillId": "skchr_aglina_3",
    "iconId": "skchr_aglina_3",
    "url": "/assets/skill/skchr_aglina_3.png",
    "name": "秘杖·反重力模式"
  },
  "char_341_sntlla:“女巫之泪”": {
    "skillId": "skchr_sntlla_2",
    "iconId": "skchr_sntlla_2",
    "url": "/assets/skill/skchr_sntlla_2.png",
    "name": "“女巫之泪”"
  },
  "char_4146_nymph:怵然震爆": {
    "skillId": "skchr_nymph_2",
    "iconId": "skchr_nymph_2",
    "url": "/assets/skill/skchr_nymph_2.png",
    "name": "怵然震爆"
  },
  "char_4196_reckpr:一点关窍": {
    "skillId": "skchr_reckpr_2",
    "iconId": "skchr_reckpr_2",
    "url": "/assets/skill/skchr_reckpr_2.png",
    "name": "一点关窍"
  },
  "char_4193_lemuen:礼炮·强制追思": {
    "skillId": "skchr_lemuen_3",
    "iconId": "skchr_lemuen_3",
    "url": "/assets/skill/skchr_lemuen_3.png",
    "name": "礼炮·强制追思"
  },
  "char_1046_sbell2:群山俯首": {
    "skillId": "skchr_sbell2_3",
    "iconId": "skchr_sbell2_3",
    "url": "/assets/skill/skchr_sbell2_3.png",
    "name": "群山俯首"
  },
  "char_2026_yu:灶里乾坤": {
    "skillId": "skchr_yu_3",
    "iconId": "skchr_yu_3",
    "url": "/assets/skill/skchr_yu_3.png",
    "name": "灶里乾坤"
  },
  "char_1012_skadi2:\"潮涌，潮枯\"": {
    "skillId": "skchr_skadi2_3",
    "iconId": "skchr_skadi2_3",
    "url": "/assets/skill/skchr_skadi2_3.png",
    "name": "\"潮涌，潮枯\""
  },
  "char_472_pasngr:辉煌裂片": {
    "skillId": "skchr_pasngr_3",
    "iconId": "skchr_pasngr_3",
    "url": "/assets/skill/skchr_pasngr_3.png",
    "name": "辉煌裂片"
  },
  "char_4058_pepe:时光震荡": {
    "skillId": "skchr_pepe_3",
    "iconId": "skchr_pepe_3",
    "url": "/assets/skill/skchr_pepe_3.png",
    "name": "时光震荡"
  },
  "char_1019_siege2:俱以我之名": {
    "skillId": "skchr_siege2_3",
    "iconId": "skchr_siege2_3",
    "url": "/assets/skill/skchr_siege2_3.png",
    "name": "俱以我之名"
  },
  "char_1020_reed2:生命火种": {
    "skillId": "skchr_reed2_3",
    "iconId": "skchr_reed2_3",
    "url": "/assets/skill/skchr_reed2_3.png",
    "name": "生命火种"
  },
  "char_245_cello:“黄金的狂喜”": {
    "skillId": "skchr_cello_1",
    "iconId": "skchr_cello_1",
    "url": "/assets/skill/skchr_cello_1.png",
    "name": "“黄金的狂喜”"
  },
  "char_249_mlyss:浅层非熵适应": {
    "skillId": "skchr_mlyss_3",
    "iconId": "skchr_mlyss_3",
    "url": "/assets/skill/skchr_mlyss_3.png",
    "name": "浅层非熵适应"
  },
  "char_391_rosmon:末梢阻断": {
    "skillId": "skchr_rosmon_2",
    "iconId": "skchr_rosmon_2",
    "url": "/assets/skill/skchr_rosmon_2.png",
    "name": "末梢阻断"
  },
  "char_1041_angel2:开火成瘾症": {
    "skillId": "skchr_angel2_2",
    "iconId": "skchr_angel2_2",
    "url": "/assets/skill/skchr_angel2_2.png",
    "name": "开火成瘾症"
  },
  "char_4042_lumen:灯火不灭": {
    "skillId": "skchr_lumen_3",
    "iconId": "skchr_lumen_3",
    "url": "/assets/skill/skchr_lumen_3.png",
    "name": "灯火不灭"
  },
  "char_4082_qiubai:问雪": {
    "skillId": "skchr_qiubai_3",
    "iconId": "skchr_qiubai_3",
    "url": "/assets/skill/skchr_qiubai_3.png",
    "name": "问雪"
  },
  "char_1047_halo2:并流连锁": {
    "skillId": "skchr_halo2_3",
    "iconId": "skchr_halo2_3",
    "url": "/assets/skill/skchr_halo2_3.png",
    "name": "并流连锁"
  },
  "char_1014_nearl2:耀阳颔首": {
    "skillId": "skchr_nearl2_3",
    "iconId": "skchr_nearl2_3",
    "url": "/assets/skill/skchr_nearl2_3.png",
    "name": "耀阳颔首"
  },
  "char_1038_whitw2:终幕·浩劫": {
    "skillId": "skchr_whitw2_3",
    "iconId": "skchr_whitw2_3",
    "url": "/assets/skill/skchr_whitw2_3.png",
    "name": "终幕·浩劫"
  },
  "char_4116_blkkgt:归于宁静": {
    "skillId": "skchr_blkkgt_3",
    "iconId": "skchr_blkkgt_3",
    "url": "/assets/skill/skchr_blkkgt_3.png",
    "name": "归于宁静"
  },
  "char_1016_agoat2:火山回响": {
    "skillId": "skchr_agoat2_3",
    "iconId": "skchr_agoat2_3",
    "url": "/assets/skill/skchr_agoat2_3.png",
    "name": "火山回响"
  },
  "char_290_vigna:槌音": {
    "skillId": "skchr_vigna_2",
    "iconId": "skchr_vigna_2",
    "url": "/assets/skill/skchr_vigna_2.png",
    "name": "槌音"
  },
  "char_183_skgoat:攻击力强化·β型": {
    "skillId": "skcom_atk_up[2]",
    "iconId": "skcom_atk_up[2]",
    "url": "/assets/skill/skcom_atk_up_2_.png",
    "name": "攻击力强化·β型"
  },
  "char_173_slchan:束缚链": {
    "skillId": "skchr_slchan_2",
    "iconId": "skchr_slchan_2",
    "url": "/assets/skill/skchr_slchan_2.png",
    "name": "束缚链"
  },
  "char_4051_akkord:震爆调谐": {
    "skillId": "skchr_akkord_2",
    "iconId": "skchr_akkord_2",
    "url": "/assets/skill/skchr_akkord_2.png",
    "name": "震爆调谐"
  },
  "char_4036_forcer:惊爆射击": {
    "skillId": "skchr_forcer_2",
    "iconId": "skchr_forcer_2",
    "url": "/assets/skill/skchr_forcer_2.png",
    "name": "惊爆射击"
  },
  "char_254_vodfox:诅咒娃娃": {
    "skillId": "skchr_vodfox_2",
    "iconId": "skchr_vodfox_2",
    "url": "/assets/skill/skchr_vodfox_2.png",
    "name": "诅咒娃娃"
  },
  "char_344_beewax:守卫尖碑": {
    "skillId": "skchr_beewax_2",
    "iconId": "skchr_beewax_2",
    "url": "/assets/skill/skchr_beewax_2.png",
    "name": "守卫尖碑"
  },
  "char_4163_rosesa:绝妙的长效药呀": {
    "skillId": "skchr_rosesa_2",
    "iconId": "skchr_rosesa_2",
    "url": "/assets/skill/skchr_rosesa_2.png",
    "name": "绝妙的长效药呀"
  },
  "char_240_wyvern:冲锋号令·援军": {
    "skillId": "skchr_wyvern_1",
    "iconId": "skchr_wyvern_1",
    "url": "/assets/skill/skchr_wyvern_1.png",
    "name": "冲锋号令·援军"
  },
  "char_484_robrta:叙拉古式上妆": {
    "skillId": "skchr_robrta_1",
    "iconId": "skchr_robrta_1",
    "url": "/assets/skill/skchr_robrta_1.png",
    "name": "叙拉古式上妆"
  },
  "char_235_jesica:强力击·β型": {
    "skillId": "skchr_jesica_1",
    "iconId": "skcom_powerstrike[2]",
    "url": "/assets/skill/skcom_powerstrike_2_.png",
    "name": "强力击·β型"
  },
  "char_366_acdrop:花式点射": {
    "skillId": "skchr_acdrop_1",
    "iconId": "skchr_acdrop_1",
    "url": "/assets/skill/skchr_acdrop_1.png",
    "name": "花式点射"
  },
  "char_242_otter:迷惑装置": {
    "skillId": "skchr_otter_1",
    "iconId": "skchr_otter_1",
    "url": "/assets/skill/skchr_otter_1.png",
    "name": "迷惑装置"
  },
  "char_451_robin:束缚“夹子”": {
    "skillId": "skchr_robin_1",
    "iconId": "skchr_robin_1",
    "url": "/assets/skill/skchr_robin_1.png",
    "name": "束缚“夹子”"
  },
  "char_4048_doroth:危险目标清除": {
    "skillId": "skchr_doroth_1",
    "iconId": "skchr_doroth_1",
    "url": "/assets/skill/skchr_doroth_1.png",
    "name": "危险目标清除"
  },
  "char_1034_jesca2:坚守阵线": {
    "skillId": "skchr_jesca2_1",
    "iconId": "skchr_jesca2_1",
    "url": "/assets/skill/skchr_jesca2_1.png",
    "name": "坚守阵线"
  },
  "char_220_grani:永不后退！": {
    "skillId": "skchr_grani_2",
    "iconId": "skchr_grani_2",
    "url": "/assets/skill/skchr_grani_2.png",
    "name": "永不后退！"
  },
  "char_4017_puzzle:关键线索": {
    "skillId": "skchr_puzzle_1",
    "iconId": "skchr_puzzle_1",
    "url": "/assets/skill/skchr_puzzle_1.png",
    "name": "关键线索"
  },
  "char_155_tiger:碎甲拳": {
    "skillId": "skchr_tiger_1",
    "iconId": "skchr_tiger_1",
    "url": "/assets/skill/skchr_tiger_1.png",
    "name": "碎甲拳"
  },
  "char_4045_heidi:虚构故事·怒士": {
    "skillId": "skchr_heidi_1",
    "iconId": "skchr_heidi_1",
    "url": "/assets/skill/skchr_heidi_1.png",
    "name": "虚构故事·怒士"
  },
  "char_154_morgan:街头好手": {
    "skillId": "skchr_morgan_1",
    "iconId": "skchr_morgan_1",
    "url": "/assets/skill/skchr_morgan_1.png",
    "name": "街头好手"
  },
  "char_112_siege:跃空锤": {
    "skillId": "skchr_siege_2",
    "iconId": "skchr_siege_2",
    "url": "/assets/skill/skchr_siege_2.png",
    "name": "跃空锤"
  },
  "char_4072_ironmn:极致火力": {
    "skillId": "skchr_ironmn_1",
    "iconId": "skchr_ironmn_1",
    "url": "/assets/skill/skchr_ironmn_1.png",
    "name": "极致火力"
  },
  "char_385_finlpp:治愈水波": {
    "skillId": "skchr_finlpp_1",
    "iconId": "skchr_finlpp_1",
    "url": "/assets/skill/skchr_finlpp_1.png",
    "name": "治愈水波"
  },
  "char_4019_ncdeer:人间降吉": {
    "skillId": "skchr_ncdeer_1",
    "iconId": "skchr_ncdeer_1",
    "url": "/assets/skill/skchr_ncdeer_1.png",
    "name": "人间降吉"
  },
  "char_4222_taraxa:何处着": {
    "skillId": "skchr_taraxa_1",
    "iconId": "skchr_taraxa_1",
    "url": "/assets/skill/skchr_taraxa_1.png",
    "name": "何处着"
  },
  "char_4119_wanqin:应东风": {
    "skillId": "skchr_wanqin_2",
    "iconId": "skchr_wanqin_2",
    "url": "/assets/skill/skchr_wanqin_2.png",
    "name": "应东风"
  },
  "char_2023_ling:宁作吾": {
    "skillId": "skchr_ling_3",
    "iconId": "skchr_ling_3",
    "url": "/assets/skill/skchr_ling_3.png",
    "name": "宁作吾"
  },
  "char_2025_shu:离离枯荣": {
    "skillId": "skchr_shu_3",
    "iconId": "skchr_shu_3",
    "url": "/assets/skill/skchr_shu_3.png",
    "name": "离离枯荣"
  },
  "char_2024_chyue:冲盈": {
    "skillId": "skchr_chyue_1",
    "iconId": "skchr_chyue_1",
    "url": "/assets/skill/skchr_chyue_1.png",
    "name": "冲盈"
  },
  "char_4032_provs:纠纷起诉": {
    "skillId": "skchr_provs_1",
    "iconId": "skchr_provs_1",
    "url": "/assets/skill/skchr_provs_1.png",
    "name": "纠纷起诉"
  },
  "char_265_sophia:鞭刃": {
    "skillId": "skchr_sophia_2",
    "iconId": "skchr_sophia_2",
    "url": "/assets/skill/skchr_sophia_2.png",
    "name": "鞭刃"
  },
  "char_204_platnm:天马视域": {
    "skillId": "skchr_platnm_2",
    "iconId": "skchr_platnm_2",
    "url": "/assets/skill/skchr_platnm_2.png",
    "name": "天马视域"
  },
  "char_190_clour:双弦开弓": {
    "skillId": "skchr_clour_2",
    "iconId": "skchr_clour_2",
    "url": "/assets/skill/skchr_clour_2.png",
    "name": "双弦开弓"
  },
  "char_346_aosta:影钉": {
    "skillId": "skchr_aosta_2",
    "iconId": "skchr_aosta_2",
    "url": "/assets/skill/skchr_aosta_2.png",
    "name": "影钉"
  },
  "char_349_chiave:火焰剥离": {
    "skillId": "skchr_chiave_2",
    "iconId": "skchr_chiave_2",
    "url": "/assets/skill/skchr_chiave_2.png",
    "name": "火焰剥离"
  },
  "char_4031_liesel:合奏起拍": {
    "skillId": "skchr_liesel_1",
    "iconId": "skchr_liesel_1",
    "url": "/assets/skill/skchr_liesel_1.png",
    "name": "合奏起拍"
  },
  "char_356_broca:通电": {
    "skillId": "skchr_broca_1",
    "iconId": "skchr_broca_1",
    "url": "/assets/skill/skchr_broca_1.png",
    "name": "通电"
  },
  "char_4065_judge:一锤定音": {
    "skillId": "skchr_judge_1",
    "iconId": "skchr_judge_1",
    "url": "/assets/skill/skchr_judge_1.png",
    "name": "一锤定音"
  },
  "char_4037_demetr:家主的余裕": {
    "skillId": "skchr_demetr_1",
    "iconId": "skchr_demetr_1",
    "url": "/assets/skill/skchr_demetr_1.png",
    "name": "家主的余裕"
  },
  "char_4155_talr:量衣尺": {
    "skillId": "skchr_talr_1",
    "iconId": "skchr_talr_1",
    "url": "/assets/skill/skchr_talr_1.png",
    "name": "量衣尺"
  }
});
export function resolveOperatorSkillIcon(operator){
 const shown=operator?.stars?.[1]?.skill??operator?.skill, native=operator?.stars?.[1]?.record?.skill??operator?.source?.normalChess?.skill;
 const mapped=FIXED_SKILLS[`${operator?.charId}:${shown?.name??native?.name??''}`];
 const skillId=operator?.chosenSkillId??shown?.skillId??native?.skillId??mapped?.skillId;
 const iconId=shown?.iconId??native?.iconId??mapped?.iconId??skillId;
 const url=assets.skillIcon(iconId,{fallback:false})??assets.skillIcon(skillId,{fallback:false})??mapped?.url??null;
 return {skillId:skillId??null,iconId:iconId??null,url,name:shown?.name??native?.name??mapped?.name??''};
}
export const operatorSkillIconUrl=operator=>resolveOperatorSkillIcon(operator).url;
