// Native skill identities restored from the authored Arknights conversion.
// No universal permanent-stat growth is added to these skills.
export const NATIVE_SKILL_IDENTITIES = {
  "char_127_estell": {
    "fixedSkill": {
      "sourceSkillId": "skchr_estell_2",
      "sourceIndex": 1,
      "name": "舍身突击",
      "kind": "instant",
      "description": "舍身突击：立即发动 8/10/12/15 秒：攻击力 +90/110/130/150%，不再成为治疗目标；持续中可重复发起，刷新持续时间。",
      "spCosts": [
        14,
        12,
        10,
        8
      ],
      "initSp": 5,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身攻击范围内至多3名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              1.3225,
              1.56,
              1.8125,
              2.08
            ],
            "maxTarget": [
              3,
              3,
              3,
              3
            ],
            "selfHpCostRatio": [
              0.3,
              0.3,
              0.3,
              0.3
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对攻击范围内至多3名敌人立即造成132.25%/156%/181.25%/208%攻击力物理伤害，并损失当前生命30%。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多3个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "舍身突击命中已被自身阻挡的敌人",
          "target": "自身",
          "action": "heal",
          "values": {
            "healScale": [
              0.35,
              0.4,
              0.45,
              0.5
            ]
          },
          "lifecycle": "instant",
          "description": "立即回复自身攻击力35%/40%/45%/50%的生命。",
          "stacking": "每次施放即时结算一次，不跨施放累积。",
          "limits": "仅在本次技能施放内结算；无合法目标时不扣除技力。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "舍身突击：立即发动 {a} 秒：攻击力 +{b}%，不再成为治疗目标；持续中可重复发起，刷新持续时间。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            90,
            110,
            130,
            150
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atk=+a%, t=dur); flag(noHealTarget)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_308_swire": {
    "fixedSkill": {
      "sourceSkillId": "skchr_swire_2",
      "sourceIndex": 1,
      "name": "协同作战",
      "kind": "instant",
      "description": "协同作战：立即发动 8/10/12/15 秒：攻击力 +50/60/70/80%，近距离作战指导提升至 3 倍；持续中可重复发起。",
      "spCosts": [
        22,
        20,
        18,
        15
      ],
      "initSp": 10,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身攻击范围内1名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              1.5,
              1.6,
              1.7,
              1.8
            ],
            "maxTarget": [
              1,
              1,
              1,
              1
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对1名合法敌人立即造成150%/160%/170%/180%攻击力的物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多1个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "同次施放",
          "target": "号令范围内至多3名其他近战友方",
          "action": "nativeMechanism",
          "values": {
            "allyImmediateAttackCount": [
              3,
              3,
              3,
              3
            ],
            "requiresLegalRange": [
              1,
              1,
              1,
              1
            ],
            "mustHaveTarget": [
              1,
              1,
              1,
              1
            ]
          },
          "lifecycle": "instant",
          "description": "号令范围内至多3名其他近战友方各自使用Battle原生即时攻击；仅有合法射程目标时执行。",
          "stacking": "每次施放立即调用一次，不建立持续强化窗口。",
          "limits": "依指定机制自身的目标合法性检查执行。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "协同作战：立即发动 {a} 秒：攻击力 +{b}%，近距离作战指导提升至 3 倍；持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            50,
            60,
            70,
            80
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atk=+b%, t=dur); talentMul(3)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_265_sophia": {
    "fixedSkill": {
      "sourceSkillId": "skchr_sophia_2",
      "sourceIndex": 1,
      "name": "鞭刃",
      "kind": "instant",
      "description": "鞭刃：立即发动 8/10/12/15 秒：责骂提升至 2 倍，攻击力 +30/40/50/60%，攻击范围 +1 格，阻挡数 +1，同时攻击阻挡的所有敌人；持续中可重复发起。",
      "spCosts": [
        24,
        22,
        20,
        17
      ],
      "initSp": 10,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身攻击范围内至多3名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              1.35,
              1.42,
              1.5,
              1.6
            ],
            "maxTarget": [
              3,
              3,
              3,
              3
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对至多3名合法敌人造成135%/142%/150%/160%攻击力的物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多3个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "施放后",
          "target": "自身及周围近战友方",
          "action": "addBuff",
          "values": {
            "barrierRatio": [
              0.08,
              0.12,
              0.16,
              0.2
            ],
            "radius": [
              1,
              1,
              1,
              1
            ],
            "targetClass": [
              "melee",
              "melee",
              "melee",
              "melee"
            ],
            "duration": [
              8,
              8,
              8,
              8
            ]
          },
          "lifecycle": "instant",
          "description": "为自身及周围近战友方各授予最大生命8%/12%/16%/20%的一次性护盾。",
          "stacking": "一次施放最多授予一次；同类屏障刷新为新值，不累加旧层。",
          "limits": "仅对本效果参数指定的合法友方目标生效。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "鞭刃：立即发动 {a} 秒：责骂提升至 2 倍，攻击力 +{b}%，攻击范围 +1 格，阻挡数 +1，同时攻击阻挡的所有敌人；持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            30,
            40,
            50,
            60
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "talentMul(2); buff(atk=+a%, range=+1, block=+1, hitAllBlocked, t=dur)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_1023_ghost2": {
    "fixedSkill": {
      "sourceSkillId": "skchr_ghost2_3",
      "sourceIndex": 2,
      "name": "生存的重压",
      "kind": "instant",
      "description": "生存的重压：立即发动 8/10/12/15 秒：攻击间隔 +50%，攻击所有阻挡的敌人，攻击力 +150/190/230/260%，生命上限 +100/140/170/200%；攻击生命比例不低于自身的敌人时追加 70% 物理伤害，否则流失 3% 生命；持续中可重复发起。",
      "spCosts": [
        24,
        21,
        18,
        15
      ],
      "initSp": 12,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身阻挡的敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              2,
              2.2,
              2.4,
              2.6
            ],
            "maxTarget": [
              99,
              99,
              99,
              99
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ],
            "blockedOnly": [
              1,
              1,
              1,
              1
            ]
          },
          "lifecycle": "instant",
          "description": "对所有自身阻挡敌人各造成200%/220%/240%/260%攻击力物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多99个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "施放时",
          "target": "自身",
          "action": "addBuff",
          "values": {
            "barrierRatio": [
              0.4,
              0.5,
              0.6,
              0.7
            ],
            "duration": [
              8,
              8,
              8,
              8
            ]
          },
          "lifecycle": "instant",
          "description": "立即获得最大生命40%/50%/60%/70%的一次性护盾。",
          "stacking": "一次施放最多授予一次；同类屏障刷新为新值，不累加旧层。",
          "limits": "仅对本效果参数指定的合法友方目标生效。"
        },
        {
          "trigger": "本次命中目标生命比例不低于自身时",
          "target": "满足条件的命中目标",
          "action": "damage",
          "values": {
            "extraAtkScale": [
              0.6,
              0.65,
              0.7,
              0.7
            ],
            "selfMaxHpLossRatio": [
              0.03,
              0.03,
              0.03,
              0.03
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ],
            "conditionalOnInitialHpRatio": [
              1,
              1,
              1,
              1
            ]
          },
          "lifecycle": "instant",
          "description": "符合初始生命比例条件的命中目标追加60%/65%/70%/70%攻击力物伤；每次触发损失自身最大生命3%。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "仅在本次技能施放内结算；无合法目标时不扣除技力。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "生存的重压：立即发动 {a} 秒：攻击间隔 +50%，攻击所有阻挡的敌人，攻击力 +{b}%，生命上限 +{c}%；攻击生命比例不低于自身的敌人时追加 70% 物理伤害，否则流失 3% 生命；持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            150,
            190,
            230,
            260
          ],
          "c": [
            100,
            140,
            170,
            200
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atk=+a%, maxHp=+b%, hitAllBlocked, t=dur); onHit(damage(70%) | loseHp(3%))",
        "limit": null,
        "scope": "timed",
        "newPrimitives": [
          "loseHp"
        ]
      }
    ]
  },
  "char_264_f12yin": {
    "fixedSkill": {
      "sourceSkillId": "skchr_f12yin_2",
      "sourceIndex": 1,
      "name": "横扫架势",
      "kind": "instant",
      "description": "横扫架势：立即进入架势 4/5/6/8 秒：防御力 -20%，攻击力 +50/60/70/80%，阻挡数 +1，同时攻击阻挡的所有敌人，每秒回复 7% 最大生命；架势中可重复发起。",
      "spCosts": [
        5,
        5,
        4,
        4
      ],
      "initSp": 0,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身攻击范围内至多2名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              2,
              2.1,
              2.2,
              2.3
            ],
            "maxTarget": [
              2,
              2,
              2,
              2
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对至多2名合法敌人立即造成200%/210%/220%/230%攻击力的物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多2个合法目标；无合法目标时不消耗技力。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "横扫架势：立即进入架势 {a} 秒：防御力 -20%，攻击力 +{b}%，阻挡数 +1，同时攻击阻挡的所有敌人，每秒回复 7% 最大生命；架势中可重复发起。",
        "params": {
          "a": [
            4,
            5,
            6,
            8
          ],
          "b": [
            50,
            60,
            70,
            80
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(def=-20%, atk=+a%, block=+1, hitAllBlocked, t=dur); hot(pct=7)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_172_svrash": {
    "fixedSkill": {
      "sourceSkillId": "skchr_svrash_2",
      "sourceIndex": 1,
      "name": "雪境生存法则",
      "kind": "instant",
      "description": "雪境生存法则：立即进入雪境姿态 4/5/6/8 秒：防御力 +100%，每秒回复 6% 最大生命；姿态中可重复发起，刷新持续时间。",
      "spCosts": [
        5,
        5,
        4,
        4
      ],
      "initSp": 0,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "自身攻击范围内1名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              2.25,
              2.45,
              2.65,
              2.9
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ],
            "maxTarget": [
              1,
              1,
              1,
              1
            ]
          },
          "lifecycle": "instant",
          "description": "对1名合法敌人立即造成225%/245%/265%/290%攻击力的物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多1个合法目标；无合法目标时不消耗技力。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "雪境生存法则：立即进入雪境姿态 {a} 秒：防御力 +100%，每秒回复 6% 最大生命；姿态中可重复发起，刷新持续时间。",
        "params": {
          "a": [
            4,
            5,
            6,
            8
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(def=+100%, t=dur); hot(pct=6)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      },
      {
        "kind": "skill",
        "template": "雪境生存法则：每次施放，你的其他干员当前再部署时间 -{a} 秒。",
        "params": {
          "a": [
            1,
            1.5,
            2,
            2
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "otherAllies",
        "effect": "redeployTimer(-b, scope=otherAllies)",
        "limit": null,
        "scope": "instant",
        "newPrimitives": [
          "redeployTimer"
        ]
      }
    ]
  },
  "char_1026_gvial2": {
    "fixedSkill": {
      "sourceSkillId": "skchr_gvial2_3",
      "sourceIndex": 2,
      "name": "丛林之魂",
      "kind": "instant",
      "description": "丛林之魂：立即发动 8/10/12/15 秒：攻击力 +80/100/120/140%，攻击速度 +100，阻挡数 +2；持续中只受到 50% 伤害，其余在结束后 20 秒内以生命流失补上；持续中可重复发起。",
      "spCosts": [
        24,
        22,
        19,
        16
      ],
      "initSp": 11,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "范围内至多5名敌人",
          "action": "damage",
          "values": {
            "hits": [
              3,
              3,
              3,
              3
            ],
            "atkScale": [
              1,
              1.1,
              1.15,
              1.2
            ],
            "maxTarget": [
              5,
              5,
              5,
              5
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对范围内至多5名敌人各造成3次100%/110%/115%/120%攻击力的物理伤害。",
          "stacking": "同次施放按hits逐击结算，每个合法目标受本效果目标数上限约束。",
          "limits": "施放瞬间只命中至多5个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "施放时",
          "target": "自身",
          "action": "addBuff",
          "values": {
            "barrierRatio": [
              0.5,
              0.6,
              0.7,
              0.8
            ],
            "duration": [
              8,
              8,
              8,
              8
            ]
          },
          "lifecycle": "instant",
          "description": "立即获得最大生命50%/60%/70%/80%的一次性护盾。",
          "stacking": "一次施放最多授予一次；同类屏障刷新为新值，不累加旧层。",
          "limits": "仅对本效果参数指定的合法友方目标生效。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "丛林之魂：立即发动 {a} 秒：攻击力 +{b}%，攻击速度 +100，阻挡数 +2；持续中只受到 50% 伤害，其余在结束后 20 秒内以生命流失补上；持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            80,
            100,
            120,
            140
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atk=+b%, aspd=+100, block=+2, t=dur); deferDamage(50%, over=20)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_263_skadi": {
    "fixedSkill": {
      "sourceSkillId": "skchr_skadi_3",
      "sourceIndex": 2,
      "name": "涌潮悲歌",
      "kind": "instant",
      "description": "涌潮悲歌：立即发动 8/10/12/15 秒：攻击力、防御力与生命上限 +80/100/115/130%；持续中可重复发起。",
      "spCosts": [
        26,
        23,
        20,
        17
      ],
      "initSp": 16,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "技力自然回满时立即施放",
          "target": "至多3名敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              2,
              2.15,
              2.3,
              2.3
            ],
            "maxTarget": [
              3,
              3,
              3,
              3
            ],
            "damageType": [
              "物理",
              "物理",
              "物理",
              "物理"
            ]
          },
          "lifecycle": "instant",
          "description": "对至多3名合法敌人立即造成200%/215%/230%/230%攻击力的物理伤害。",
          "stacking": "每次施放对每个命中目标结算一次；多段或附加伤害按字段各自结算，不跨施放叠加。",
          "limits": "施放瞬间只命中至多3个合法目标；无合法目标时不消耗技力。"
        },
        {
          "trigger": "施放后",
          "target": "自身",
          "action": "heal",
          "values": {
            "maxHpRatio": [
              0.3,
              0.35,
              0.4,
              0.45
            ]
          },
          "lifecycle": "instant",
          "description": "立即回复自身最大生命30%/35%/40%/45%。",
          "stacking": "每次施放即时结算一次，不跨施放累积。",
          "limits": "仅在本次技能施放内结算；无合法目标时不扣除技力。"
        },
        {
          "trigger": "施放后",
          "target": "自身",
          "action": "addBuff",
          "values": {
            "barrierRatio": [
              0.5,
              0.6,
              0.7,
              0.8
            ],
            "duration": [
              8,
              8,
              8,
              8
            ]
          },
          "lifecycle": "instant",
          "description": "获得最大生命50%/60%/70%/80%的一次性护盾。",
          "stacking": "一次施放最多授予一次；同类屏障刷新为新值，不累加旧层。",
          "limits": "仅对本效果参数指定的合法友方目标生效。"
        }
      ],
      "spType": "time",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "涌潮悲歌：立即发动 {a} 秒：攻击力、防御力与生命上限 +{b}%；持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            80,
            100,
            115,
            130
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atk=+b%, def=+b%, maxHp=+b%, t=dur)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_204_platnm": {
    "fixedSkill": {
      "sourceSkillId": "skchr_platnm_2",
      "sourceIndex": 1,
      "name": "天马视域",
      "kind": "instant",
      "description": "天马视域：立即发动 10/12/14/16 秒：攻击速度略微降低，攻击力 +60/70/85/100%，攻击范围扩大。持续中可重复发起。",
      "spCosts": [
        63,
        56,
        50,
        44
      ],
      "initSp": [
        0,
        5,
        10,
        15
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "自身当前攻击目标",
          "action": "damage",
          "values": {
            "atkScale": [
              2,
              2.3,
              2.6,
              3
            ],
            "dmgType": "phys"
          },
          "lifecycle": "instant",
          "description": "立即结算一次蓄力射击，造成攻击力200%/230%/260%/300%的物理伤害；无目标不结算。",
          "stacking": "同一结算每目标一次",
          "limits": "每次技力满一次"
        },
        {
          "trigger": "同一结算",
          "target": "本次攻击倍率",
          "action": "nativeMechanism",
          "values": {
            "atk": [
              0.7,
              0.85,
              1,
              1.2
            ],
            "noRangeOrAttackSpeedWindow": true
          },
          "lifecycle": "instant",
          "description": "进入视域16/18/20/22秒：攻击力+70%/85%/100%/120%，攻击范围扩大（原生扩大版rangeGrid），攻速-20。",
          "stacking": "同名刷新不叠加",
          "limits": "每次结算刷新一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "天马视域：立即发动 {a} 秒：攻击速度略微降低，攻击力 +{b}%，攻击范围扩大。持续中可重复发起。",
        "params": {
          "a": [
            10,
            12,
            14,
            16
          ],
          "b": [
            60,
            70,
            85,
            100
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(aspd=-10, atkPct=b, range=+1, t=a); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_145_prove": {
    "fixedSkill": {
      "sourceSkillId": "skchr_prove_2",
      "sourceIndex": 1,
      "name": "杀戮嗅觉",
      "kind": "instant",
      "description": "杀戮嗅觉：立即发动 10/12/14/16 秒：攻击力 +130/160/190/220%，普通攻击不再以生命高于 80% 的敌人为目标。持续中可重复发起。",
      "spCosts": [
        30,
        30,
        28,
        26
      ],
      "initSp": [
        0,
        4,
        8,
        12
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "攻击范围内生命值低于80%的敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              1.6,
              1.8,
              2,
              2.3
            ],
            "hpThreshold": 0.8,
            "perStepBonus": [
              0.16,
              0.18,
              0.2,
              0.25
            ],
            "hpStep": 0.2,
            "dmgType": "phys"
          },
          "lifecycle": "instant",
          "description": "立即对符合残血条件的当前目标结算一次物理伤害，基础为攻击力160%/180%/200%/230%；目标生命每低一个20%档位额外+16%/18%/20%/25%。",
          "stacking": "同一结算只对单一目标一次",
          "limits": "每次技力满一次"
        },
        {
          "trigger": "同一结算击杀敌人",
          "target": "自身",
          "action": "spGain",
          "values": {
            "sp": [
              4,
              5,
              6,
              7
            ]
          },
          "lifecycle": "instant",
          "description": "若该发射击击杀目标，立即回复4/5/6/7点技力，形成斩杀循环。",
          "stacking": "每次击杀一次",
          "limits": "每次击杀一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "杀戮嗅觉：立即发动 {b} 秒：攻击力 +{c}%，普通攻击不再以生命高于 80% 的敌人为目标。持续中可重复发起。",
        "params": {
          "b": [
            10,
            12,
            14,
            16
          ],
          "c": [
            130,
            160,
            190,
            220
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atkPct=c, targetFilter=hp<80%, t=b); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_174_slbell": {
    "fixedSkill": {
      "sourceSkillId": "skchr_slbell_2",
      "sourceIndex": 1,
      "name": "自然震慑",
      "kind": "instant",
      "description": "自然震慑：攻击范围内所有敌人防御力 -40/45/50/60%、法术抗性 -20/22/25/30%，持续 6/7/8/10 秒。",
      "spCosts": [
        20,
        18,
        16,
        14
      ],
      "initSp": [
        10,
        12,
        14,
        14
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "自身原攻击范围内所有敌人",
          "action": "applyStatus",
          "values": {
            "status": "寒冷",
            "duration": [
              1.5,
              1.8,
              2.1,
              2.5
            ],
            "slow": [
              0.4,
              0.45,
              0.5,
              0.55
            ]
          },
          "lifecycle": "battle",
          "description": "立即对原攻击范围内每个敌人成功施加一次1.5/1.8/2.1/2.5秒寒冷，减速40%/45%/50%/55%；已处于寒冷或冻结的敌人再次收到仍计一次成功施加。",
          "stacking": "同名寒冷刷新剩余时间，不叠层",
          "limits": "每次技力满对范围内每个敌人施加一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "自然震慑：攻击范围内所有敌人防御力 -{a}%、法术抗性 -{b}%，持续 {c} 秒。",
        "params": {
          "a": [
            40,
            45,
            50,
            60
          ],
          "b": [
            20,
            22,
            25,
            30
          ],
          "c": [
            6,
            7,
            8,
            10
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "enemies(range, all)",
        "effect": "status(defDown, pct=a, t=c); status(resDown, pct=b, t=c)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      },
      {
        "kind": "skill",
        "template": "自然震慑：持续中可重复发起，刷新持续时间。",
        "params": {},
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "refresh()",
        "limit": null,
        "scope": "instant",
        "newPrimitives": []
      }
    ]
  },
  "char_4122_grabds": {
    "fixedSkill": {
      "sourceSkillId": "skchr_grabds_2",
      "sourceIndex": 1,
      "name": "乡音沉沉",
      "kind": "instant",
      "description": "乡音沉沉：立即使攻击范围内 3 名敌人沉睡 3/4/4/5 秒。",
      "spCosts": [
        25,
        23,
        22,
        20
      ],
      "initSp": [
        6,
        6,
        6,
        5
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "至多2名目标",
          "action": "damage",
          "values": {
            "atkScale": [
              1.7,
              1.8,
              1.9,
              2.1
            ],
            "maxTarget": 2,
            "dmgType": "arts",
            "moduleSleepDuration": 2
          },
          "lifecycle": "instant",
          "description": "施放时造成一次法术伤害；模组额外选择目标并令存活目标沉睡2秒。",
          "stacking": "每名合法目标本次最多命中一次；模组命中后各施加一次沉睡。",
          "limits": "基础最多2名目标，模组最多3名。"
        }
      ],
      "resolution": "single-cast-v2",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "乡音沉沉：立即使攻击范围内 3 名敌人沉睡 {a} 秒。",
        "params": {
          "a": [
            3,
            4,
            4,
            5
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "enemies(range, count=3)",
        "effect": "status(sleep, t=a)",
        "limit": null,
        "scope": "instant",
        "newPrimitives": []
      },
      {
        "kind": "skill",
        "template": "乡音沉沉：之后 {b} 秒，攻击速度 +{c}，同时攻击 3 名敌人。持续中可重复发起。",
        "params": {
          "b": [
            8,
            10,
            12,
            15
          ],
          "c": [
            80,
            100,
            115,
            130
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(aspd=c, targets=3, t=b); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_4045_heidi": {
    "fixedSkill": {
      "sourceSkillId": "skchr_heidi_2",
      "sourceIndex": 1,
      "name": "虚构故事·锈城",
      "kind": "instant",
      "description": "虚构故事·锈城：立即发动 10/12/14/16 秒：攻击范围内其他干员阻挡数 +1，获得相当于海蒂 70% 防御力与 30% 生命上限的鼓舞。持续中可重复发起。",
      "spCosts": [
        30,
        30,
        28,
        26
      ],
      "initSp": [
        15,
        18,
        20,
        22
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "攻击范围内友方",
          "action": "nativeMechanism",
          "values": {
            "healAtkScale": [
              1.15,
              1.25,
              1.4,
              1.5
            ],
            "shieldRatio": [
              0.2,
              0.22,
              0.25,
              0.3
            ],
            "noInspirationWindow": true
          },
          "lifecycle": "instant",
          "description": "施放时立即治疗范围内友方并各授予一次最大生命比例护盾。",
          "stacking": "每名友方每次施放治疗、护盾各一次；重复施放刷新同名护盾。",
          "limits": "只影响施放时攻击范围内有效友方。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "虚构故事·锈城：立即发动 {b} 秒：攻击范围内其他干员阻挡数 +1，获得相当于海蒂 70% 防御力与 30% 生命上限的鼓舞。持续中可重复发起。",
        "params": {
          "b": [
            10,
            12,
            14,
            16
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "allies(range)",
        "effect": "buff(block=+1, inspireDef=70, inspireHp=30, t=b); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_4019_ncdeer": {
    "fixedSkill": {
      "sourceSkillId": "skchr_ncdeer_2",
      "sourceIndex": 1,
      "name": "仙山去远",
      "kind": "instant",
      "description": "仙山去远：立即发动 8/10/12/15 秒：攻击速度 +30/35/40/50，获得 70% 远程物理抵挡；飘渺彩云对攻击范围内所有干员生效。持续中可重复发起。",
      "spCosts": [
        40,
        38,
        36,
        34
      ],
      "initSp": [
        28,
        29,
        30,
        32
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "攻击范围内所有友方",
          "action": "heal",
          "values": {
            "atkScale": [
              0.75,
              0.8,
              0.85,
              0.9
            ]
          },
          "lifecycle": "instant",
          "description": "立即为范围内每个友方治疗一次，治疗量为九色鹿攻击力的75%/80%/85%/90%。",
          "stacking": "同一结算每目标一次",
          "limits": "每次技力满一次"
        },
        {
          "trigger": "同一结算",
          "target": "攻击范围内所有友方",
          "action": "applyStatus",
          "values": {
            "status": "庇护",
            "damageResistance": [
              0.1,
              0.12,
              0.15,
              0.18
            ],
            "duration": [
              10,
              10,
              12,
              12
            ]
          },
          "lifecycle": "battle",
          "description": "范围内友方获得10%/12%/15%/18%伤害减免（庇护），持续10/10/12/12秒。",
          "stacking": "同名庇护取最高值，不叠层",
          "limits": "每次结算每目标一次"
        },
        {
          "trigger": "同一结算",
          "target": "自身",
          "action": "addBuff",
          "values": {
            "rangedPhysicalBlockProb": [
              0.4,
              0.5,
              0.6,
              0.7
            ],
            "duration": [
              15,
              16,
              18,
              20
            ]
          },
          "lifecycle": "battle",
          "description": "结算后自身获得40%/50%/60%/70%远程物理抵挡，持续15/16/18/20秒。",
          "stacking": "同名刷新不叠加",
          "limits": "每次结算刷新一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "仙山去远：立即发动 {c} 秒：攻击速度 +{d}，获得 70% 远程物理抵挡；飘渺彩云对攻击范围内所有干员生效。持续中可重复发起。",
        "params": {
          "c": [
            8,
            10,
            12,
            15
          ],
          "d": [
            30,
            35,
            40,
            50
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(aspd=d, rangedPhysDodge=70, t=c); mod(talentHpGate=100); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_1012_skadi2": {
    "fixedSkill": {
      "sourceSkillId": "skchr_skadi2_3",
      "sourceIndex": 2,
      "name": "“潮涌，潮枯”",
      "kind": "instant",
      "description": "“潮涌，潮枯”：立即发动 8/10/12/15 秒：此干员每秒流失 5% 生命，攻击范围内所有敌人每秒受到 70% 攻击力的真实伤害。",
      "spCosts": [
        38,
        36,
        35,
        32
      ],
      "initSp": [
        15,
        15,
        15,
        15
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "范围敌人及友方",
          "action": "nativeMechanism",
          "values": {
            "enemyTrueScale": [
              1.65,
              1.8,
              1.95,
              2.1
            ],
            "selfCurrentHpLossRatio": 0.1,
            "allyHealAtkScale": [
              0.8,
              0.9,
              1,
              1.1
            ],
            "noWindows": true
          },
          "lifecycle": "instant",
          "description": "施放时对范围敌人造成一次真实伤害，并治疗范围友方一次。",
          "stacking": "每名敌人与友方各处理一次；真实伤害和治疗不重复触发。",
          "limits": "仅对施放时合法范围目标结算。"
        }
      ],
      "resolution": "single-cast-v2",
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "“潮涌，潮枯”：立即发动 {a} 秒：此干员每秒流失 5% 生命，攻击范围内所有敌人每秒受到 70% 攻击力的真实伤害。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "enemies(range)",
        "effect": "selfHpLoss(5/s); damage(scale=70, type=true, every=1, t=a)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      },
      {
        "kind": "skill",
        "template": "“潮涌，潮枯”：期间范围内所有干员获得相当于此干员 {b}% 攻击力的鼓舞；持续中可重复发起。",
        "params": {
          "b": [
            60,
            80,
            95,
            110
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "allies(range)",
        "effect": "buff(inspireAtk=b, t=a); refresh()",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_240_wyvern": {
    "fixedSkill": {
      "sourceSkillId": "skchr_wyvern_1",
      "sourceIndex": 0,
      "name": "冲锋号令·援军",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "冲锋号令·援军：立即获得 3/4/5/6 费用，此干员攻击力 +35%，持续 10 秒。持续中可重复发起。",
      "spCosts": [
        20,
        17,
        17,
        17
      ],
      "initSp": [
        6,
        6,
        8,
        10
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "costGain": [
              3,
              4,
              5,
              6
            ]
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即获得部署费用。获得费用引发的攻击提升由天赋和进击被动分别结算。\n部署费用+3/4/5/6。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "冲锋号令·援军：立即获得 {b} 费用，此干员攻击力 +35%，持续 10 秒。持续中可重复发起。",
        "params": {
          "b": [
            3,
            4,
            5,
            6
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self+player",
        "effect": "dp(b); buff(atkPct=35, t=10)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_290_vigna": {
    "fixedSkill": {
      "sourceSkillId": "skchr_vigna_2",
      "sourceIndex": 1,
      "name": "槌音",
      "kind": "instant",
      "description": "槌音：立即进入 8/10/12/15 秒：攻击间隔 +0.5 秒，攻击力 +120/150/180/200%。持续中可重复发起。",
      "spCosts": [
        28,
        24,
        24,
        24
      ],
      "initSp": [
        5,
        5,
        8,
        10
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "前方攻击范围内敌人",
          "action": "damage",
          "values": {
            "atkScale": [
              1.6,
              2,
              2.4,
              3
            ],
            "targets": [
              1,
              1,
              2,
              2
            ]
          },
          "lifecycle": "instant",
          "description": "对至多1/1/2/2名敌人造成攻击力160%/200%/240%/300%的物理伤害。",
          "stacking": "每次结算各目标独立结算一次",
          "limits": "每场战斗不限次数"
        },
        {
          "trigger": "同一结算",
          "target": "本次穿刺命中目标",
          "action": "nativeMechanism",
          "values": {
            "modifiesEffectIndex": 0,
            "critProb": [
              0.3,
              0.3,
              0.3,
              0.3
            ],
            "critScale": [
              1.5,
              1.75,
              2,
              2.5
            ],
            "rngPerCast": 1,
            "noExtraDamageInstance": 1
          },
          "lifecycle": "instant",
          "description": "对本次施法自身穿刺的直接伤害做一次30%暴击判定：命中则本次直接伤害倍率变为150%/175%/200%/250%，未命中按基准结算；一次施法只消耗一次RNG，不额外产生第二段damage。",
          "stacking": "每次施法只判定一次",
          "limits": "无额外次数限制"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "槌音：立即进入 {e} 秒：攻击间隔 +0.5 秒，攻击力 +{a}%。持续中可重复发起。",
        "params": {
          "e": [
            8,
            10,
            12,
            15
          ],
          "a": [
            120,
            150,
            180,
            200
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atkPct=a, aspd=-, t=t)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_181_flower": {
    "fixedSkill": {
      "sourceSkillId": "skchr_flower_2",
      "sourceIndex": 1,
      "name": "精调",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "精调：立即进入 8/10/12/15 秒：攻击速度 -50，攻击力 +250%。持续中可重复发起。",
      "spCosts": [
        60,
        60,
        60,
        60
      ],
      "initSp": [
        20,
        20,
        20,
        20
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "healScale": [
              1.5,
              1.8,
              2.1,
              2.5
            ],
            "maxTargets": 99
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即精调药剂，为攻击范围内全部伤员进行一次强化治疗。\n每名伤员回复相当于攻击力150%/180%/210%/250%的生命。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "精调：立即进入 {c} 秒：攻击速度 -50，攻击力 +250%。持续中可重复发起。",
        "params": {
          "c": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(aspd=-50, atkPct=250, t=t)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_199_yak": {
    "fixedSkill": {
      "sourceSkillId": "skchr_yak_2",
      "sourceIndex": 1,
      "name": "抗寒体质",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "抗寒体质：立即发动 8/10/12/15 秒：生命上限 +50%，防御力 +30%，法术抗性 +100。持续中可重复发起。",
      "spCosts": [
        32,
        28,
        28,
        28
      ],
      "initSp": [
        5,
        5,
        10,
        10
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "artsShieldRatio": [
              0.4,
              0.5,
              0.6,
              0.7
            ]
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即凝结抗寒护层；护层仅吸收法术伤害，耗尽后消失。\n法术护盾量为自身生命上限的40%/50%/60%/70%。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "抗寒体质：立即发动 {a} 秒：生命上限 +50%，防御力 +30%，法术抗性 +100。持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(hpPct=50, defPct=30, res=100, t=t)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_150_snakek": {
    "fixedSkill": {
      "sourceSkillId": "skchr_snakek_2",
      "sourceIndex": 1,
      "name": "壳状防御",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "壳状防御：立即发动 8/10/12/15 秒：停止攻击，阻挡数 +1，防御力 +130%，每秒回复 3% 最大生命。持续中可重复发起。",
      "spCosts": [
        40,
        34,
        34,
        34
      ],
      "initSp": [
        0,
        0,
        5,
        5
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "healHpRatio": [
              0.12,
              0.15,
              0.18,
              0.21
            ],
            "shieldRatio": [
              0.3,
              0.35,
              0.4,
              0.45
            ]
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即修复自身并凝结一次壳状屏障。\n回复生命上限的12%/15%/18%/21%，护盾量为生命上限的30%/35%/40%/45%。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "壳状防御：立即发动 {d} 秒：停止攻击，阻挡数 +1，防御力 +130%，每秒回复 3% 最大生命。持续中可重复发起。",
        "params": {
          "d": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(block=+1, defPct=130, regenPct=3, t=t)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_401_elysm": {
    "fixedSkill": {
      "sourceSkillId": "skchr_elysm_2",
      "sourceIndex": 1,
      "name": "聆听",
      "kind": "instant",
      "description": "聆听：停止攻击，8 秒内逐渐获得 12/14/16/18 费用；锁定周围 4/4/4/5 名敌人：移动速度 -60%，防御力 -35%，隐匿失效，持续 10/12/15/15 秒。持续中可重复发起。",
      "spCosts": [
        34,
        30,
        30,
        30
      ],
      "initSp": [
        10,
        10,
        16,
        16
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "自身经济",
          "action": "economy",
          "values": {
            "costGain": [
              12,
              14,
              16,
              18
            ]
          },
          "lifecycle": "instant",
          "description": "立即获得12/14/16/18点部署费用。",
          "stacking": "单次结算一次",
          "limits": "每场战斗不限次数"
        },
        {
          "trigger": "同一结算",
          "target": "周围至多4名敌人",
          "action": "applyStatus",
          "values": {
            "maxTargets": [
              4,
              4,
              4,
              5
            ],
            "slow": [
              0.6,
              0.6,
              0.6,
              0.7
            ],
            "defDown": [
              0.25,
              0.3,
              0.35,
              0.4
            ],
            "reveal": [
              1,
              1,
              1,
              1
            ],
            "duration": [
              10,
              12,
              15,
              15
            ]
          },
          "lifecycle": "battle",
          "description": "锁定至多4/4/4/5名敌人，10/12/15/15秒内移速-60%/60%/60%/70%、防御-25%/30%/35%/40%，并使隐匿失效。",
          "stacking": "同名减益取较强；重复锁定的新目标追加，旧目标刷新",
          "limits": "每目标一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "聆听：停止攻击，8 秒内逐渐获得 {a} 费用；锁定周围 {d} 名敌人：移动速度 -60%，防御力 -35%，隐匿失效，持续 {e} 秒。持续中可重复发起。",
        "params": {
          "a": [
            12,
            14,
            16,
            18
          ],
          "d": [
            4,
            4,
            4,
            5
          ],
          "e": [
            10,
            12,
            15,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "enemies(around, n)",
        "effect": "dp(a, over=8s); debuff(moveSpd=-60%, defPct=-35, reveal, t=t)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ],
    "supportLine": {
      "kind": "talent",
      "template": "狙击支援：此干员施放技能时，你的狙击干员攻击速度 +{b}，持续 15 秒。",
      "params": {
        "b": [
          15,
          18,
          20,
          26
        ]
      },
      "trigger": {
        "event": "skillStart",
        "subject": "self",
        "condition": null
      },
      "target": "allies:狙击",
      "effect": "buff(aspd=b, t=15)",
      "limit": null,
      "scope": "instant",
      "newPrimitives": []
    },
    "modules": [
      {
        "id": "uniequip_002_elysm",
        "name": "应急通讯指南",
        "line": {
          "kind": "module",
          "template": "应急通讯指南：技能锁定的敌人受到的伤害 +{c}%。",
          "params": {
            "c": [
              null,
              null,
              12,
              12
            ]
          },
          "trigger": {
            "event": "static",
            "subject": "self",
            "condition": null
          },
          "target": "self",
          "effect": "mod(lockedDmgTaken=+c)",
          "limit": null,
          "scope": "instant",
          "newPrimitives": []
        }
      }
    ]
  },
  "char_4119_wanqin": {
    "fixedSkill": {
      "sourceSkillId": "skchr_wanqin_2",
      "sourceIndex": 1,
      "name": "应东风",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "应东风：停止攻击，15 秒内逐渐获得 12/14/16/18 费用；期间每秒治疗周围干员 25% 攻击力，周围干员攻击速度 +25。持续中可重复发起。",
      "spCosts": [
        34,
        30,
        30,
        30
      ],
      "initSp": [
        10,
        10,
        16,
        16
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "costGain": [
              12,
              14,
              16,
              18
            ],
            "healScale": [
              0.6,
              0.75,
              0.9,
              1.1
            ],
            "spGain": [
              1,
              1.5,
              2,
              2.5
            ]
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即获得部署费用、治疗周围友方，并为同朝向友方补充技力。\n部署费用+12/14/16/18；治疗量为攻击力的60%/75%/90%/110%，同朝向友方技力+1/1.5/2/2.5。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "应东风：停止攻击，15 秒内逐渐获得 {b} 费用；期间每秒治疗周围干员 25% 攻击力，周围干员攻击速度 +25。持续中可重复发起。",
        "params": {
          "b": [
            12,
            14,
            16,
            18
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "player+allies(around)",
        "effect": "dp(b, over=15s); heal(scale=25, perSec); buff(aspd=25)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_171_bldsk": {
    "fixedSkill": {
      "sourceSkillId": "skchr_bldsk_2",
      "sourceIndex": 1,
      "name": "不稳定血浆",
      "kind": "instant",
      "description": "不稳定血浆：此干员与攻击范围内 1 名干员攻击力 +60/70/90/100%，每秒流失 3% 最大生命，持续 15 秒。",
      "spCosts": [
        60,
        50,
        50,
        50
      ],
      "initSp": [
        45,
        45,
        50,
        50
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满",
          "target": "自身与范围内随机1名友方",
          "action": "addBuff",
          "values": {
            "atk": [
              0.6,
              0.7,
              0.9,
              1
            ],
            "duration": [
              15,
              15,
              15,
              15
            ]
          },
          "lifecycle": "battle",
          "description": "目标攻击力+60%/70%/90%/100%，持续15秒；同名刷新取较强值。",
          "stacking": "同名取较强不叠加",
          "limits": "每场战斗不限次数"
        },
        {
          "trigger": "同一结算",
          "target": "被增益单位",
          "action": "applyStatus",
          "values": {
            "hpDrainPerSec": [
              0.03,
              0.03,
              0.03,
              0.04
            ],
            "duration": [
              15,
              15,
              15,
              15
            ]
          },
          "lifecycle": "battle",
          "description": "被增益单位每秒流失最大生命3%/3%/3%/4%，持续15秒；该流失不被减伤或护盾抵消。",
          "stacking": "同名刷新不叠加损失速率",
          "limits": "每秒结算一次"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "不稳定血浆：此干员与攻击范围内 1 名干员攻击力 +{b}%，每秒流失 3% 最大生命，持续 15 秒。",
        "params": {
          "b": [
            60,
            70,
            90,
            100
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self+ally(range, 1)",
        "effect": "buff(atkPct=b, t=15); loseHp(pctMax=3, perSec)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": [
          "loseHp"
        ]
      }
    ]
  },
  "char_4207_branch": {
    "fixedSkill": {
      "sourceSkillId": "skchr_branch_2",
      "sourceIndex": 1,
      "name": "生存决心",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "生存决心：立即发动 8/10/12/15 秒：周围的地面敌人战栗 5 秒；攻击力 +150%，防御力 +50%，同时攻击阻挡的所有敌人。持续中可重复发起。",
      "spCosts": [
        22,
        18,
        18,
        18
      ],
      "initSp": [
        3,
        5,
        8,
        8
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "fear": 5,
            "atkScale": [
              2.2,
              2.35,
              2.5,
              2.7
            ],
            "damageType": "phys"
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即使周围地面敌人战栗，并对自身阻挡目标进行一次强化攻击。\n战栗5秒，强化攻击造成攻击力220%/235%/250%/270%的物理伤害。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "生存决心：立即发动 {a} 秒：周围的地面敌人战栗 5 秒；攻击力 +150%，防御力 +50%，同时攻击阻挡的所有敌人。持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self+enemies(around, ground)",
        "effect": "status(tremble, t=5); buff(atkPct=150, defPct=50, hitAllBlocked, t=a)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_136_hsguma": {
    "fixedSkill": {
      "sourceSkillId": "skchr_hsguma_3",
      "sourceIndex": 2,
      "name": "力之锯",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "力之锯：立即进入 8/10/12/15 秒：攻击力 +140%，防御力 +90%，用盾牌切割前方一格的所有敌人。持续中可重复发起。",
      "spCosts": [
        30,
        34,
        38,
        42
      ],
      "initSp": [
        18,
        20,
        25,
        30
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "atkScale": [
              1.96,
              2.4,
              2.88,
              3.4
            ],
            "shieldRatio": [
              0.2,
              0.25,
              0.3,
              0.35
            ],
            "damageType": "phys"
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即以力之锯扫击前方敌人，并授予自身一次屏障。\n造成攻击力196%/240%/288%/340%的物理伤害；护盾为生命上限的20%/25%/30%/35%。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "力之锯：立即进入 {a} 秒：攻击力 +140%，防御力 +90%，用盾牌切割前方一格的所有敌人。持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self+enemies(front1)",
        "effect": "buff(atkPct=140, defPct=90, t=a); hitAll(front1)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_2026_yu": {
    "fixedSkill": {
      "sourceSkillId": "skchr_yu_2",
      "sourceIndex": 1,
      "name": "厚礼上宾",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "厚礼上宾：对周围所有敌人造成 100% 攻击力的法术伤害，并把其中的地面敌人传送到此干员位置。",
      "spCosts": [
        18,
        22,
        26,
        29
      ],
      "initSp": 0,
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "atkScale": [
              1,
              1.5,
              2.2,
              2.9
            ],
            "maxTargets": [
              3,
              4,
              5,
              6
            ],
            "shieldRatio": [
              0.3,
              0.35,
              0.4,
              0.45
            ],
            "damageType": "arts"
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即对周围敌人造成法术伤害，将可达地面目标牵至身边，并授予自身一次屏障。\n至多3/4/5/6名敌人各受到攻击力100%/150%/220%/290%的法术伤害；护盾为生命上限的30%/35%/40%/45%。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "厚礼上宾：对周围所有敌人造成 100% 攻击力的法术伤害，并把其中的地面敌人传送到此干员位置。",
        "params": {},
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "enemies(around)",
        "effect": "damage(scale=100, arts); teleport(to=self, ground)",
        "limit": null,
        "scope": "instant",
        "newPrimitives": [
          "teleport"
        ]
      },
      {
        "kind": "skill",
        "template": "厚礼上宾：之后 {a} 秒：阻挡数 +2，生命上限 +{b}%，攻击力 +{c}%，普通攻击造成法术伤害。持续中可重复发起。",
        "params": {
          "a": [
            8,
            10,
            12,
            15
          ],
          "b": [
            80,
            110,
            130,
            160
          ],
          "c": [
            150,
            200,
            250,
            290
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(block=+2, hpPct=b, atkPct=c, dmgType=arts, t=a)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  },
  "char_220_grani": {
    "fixedSkill": {
      "sourceSkillId": "skchr_grani_2",
      "sourceIndex": 1,
      "name": "永不后退！",
      "kind": "instant",
      "resolution": "single-cast-v2",
      "description": "永不后退！：立即进入 10/12/14/15 秒：攻击力与防御力 +80%，阻挡数 +1，同时攻击阻挡的所有敌人。持续中可重复发起。",
      "spCosts": [
        40,
        45,
        50,
        55
      ],
      "initSp": [
        25,
        30,
        35,
        38
      ],
      "recoveryPerSec": 1,
      "effects": [
        {
          "trigger": "自然技力满时本次结算",
          "target": "按技能指定的合法目标",
          "action": "nativeMechanism",
          "values": {
            "atkScale": [
              1.6,
              1.65,
              1.8,
              1.9
            ],
            "shieldRatio": [
              0.2,
              0.25,
              0.3,
              0.35
            ],
            "damageType": "phys"
          },
          "lifecycle": "instant",
          "description": "自然技力满时自动施放：立即攻击自身阻挡的所有敌人，并获得一次冲锋屏障。\n各造成攻击力160%/165%/180%/190%的物理伤害；护盾为生命上限的20%/25%/30%/35%。",
          "stacking": "每次施放独立结算；同名防护只取较强值，不叠加无限层数。",
          "limits": "无合法目标和可结算行动时保留技力；不产生本体持续强化或后续普攻窗口。"
        }
      ],
      "charges": 1
    },
    "lines": [
      {
        "kind": "skill",
        "template": "永不后退！：立即进入 {a} 秒：攻击力与防御力 +80%，阻挡数 +1，同时攻击阻挡的所有敌人。持续中可重复发起。",
        "params": {
          "a": [
            10,
            12,
            14,
            15
          ]
        },
        "trigger": {
          "event": "skillReady",
          "subject": "self",
          "condition": null
        },
        "target": "self",
        "effect": "buff(atkPct=80, defPct=80, block=+1, hitAllBlocked, t=a)",
        "limit": null,
        "scope": "timed",
        "newPrimitives": []
      }
    ]
  }
};
