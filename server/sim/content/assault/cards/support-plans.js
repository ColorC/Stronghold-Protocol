// Offline typed translations: runtime consumes enums only; source localization is not interpreted here.
export const supportPlans = {
  "char_240_wyvern": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "costGain": [
              3,
              4,
              5,
              6
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              0.2,
              0.28,
              0.36,
              0.45
            ],
            "duration": [
              8,
              8,
              9,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_240_wyvern/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "atkByStar": [
            0.08,
            0.14,
            0.2,
            0.28
          ],
          "duration": 8
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "dpReceivedPerPoint",
        "target": "self",
        "params": {
          "atk": [
            0.02,
            0.03,
            0.04,
            0.05
          ],
          "maxStacks": [
            5,
            5,
            5,
            5
          ],
          "rechargeSec": [
            8,
            8,
            6,
            6
          ]
        }
      }
    ],
    "modules": []
  },
  "char_290_vigna": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "frontRangeEnemies",
          "params": {
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
          }
        },
        {
          "index": 1,
          "action": "nativeMechanism",
          "trigger": "skillResolve",
          "target": "hitTargets",
          "params": {
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
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_290_vigna/talents/0",
        "mode": "rewrite",
        "target": "selfSkill",
        "parameters": {
          "delegatesToFixedSkillEffect": 1,
          "executionOwner": "fixedSkill",
          "critProb": 0.3,
          "critScaleByStar": [
            1.5,
            1.75,
            2,
            2.5
          ],
          "rngPerCast": 1,
          "appliesTo": "firstDirectDamageMultiplier",
          "noExtraDamageInstance": true
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "economy",
        "trigger": "enemyKilled",
        "target": "self",
        "params": {
          "costGain": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_vigna"
      }
    ]
  },
  "char_151_myrtle": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              10,
              12,
              14,
              16
            ]
          }
        },
        {
          "index": 1,
          "action": "modifyTag",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "blockCnt": [
              0,
              0,
              0,
              0
            ],
            "duration": [
              3,
              3,
              4,
              4
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_151_myrtle/talents/0",
        "mode": "rewrite",
        "target": "rangePioneerAllies",
        "parameters": {
          "healScaleByStar": [
            0.25,
            0.3,
            0.35,
            0.4
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "heal",
        "trigger": "dpReceived",
        "target": "rangeAlliesPioneer",
        "params": {
          "healScale": [
            0.25,
            0.3,
            0.35,
            0.4
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_myrtle"
      }
    ]
  },
  "char_181_flower": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1,
              1.25,
              1.5,
              1.8
            ],
            "targets": [
              2,
              3,
              3,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_181_flower/talents/0",
        "mode": "rewrite",
        "target": "allAllies",
        "parameters": {
          "healPerSec": [
            0.03,
            0.04,
            0.05,
            0.06
          ],
          "duration": [
            6,
            7,
            8,
            8
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "heal",
        "trigger": "skillSettled",
        "target": "allAllies",
        "params": {
          "healPerSec": [
            0.03,
            0.04,
            0.05,
            0.06
          ],
          "duration": [
            6,
            7,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_flower"
      }
    ]
  },
  "char_385_finlpp": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              2,
              2.6,
              3.2,
              4
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_385_finlpp/talents/0",
        "mode": "rewrite",
        "target": "healedTargets",
        "parameters": {
          "resistSec": [
            2,
            3,
            4,
            4
          ],
          "oneMinusResist": 0.5
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "healedIncludingModule",
        "target": "healedTargets",
        "params": {
          "status": "resist",
          "statusDurationMultiplier": 0.5,
          "resistSec": [
            2,
            3,
            4,
            4
          ],
          "selfAlso": [
            0,
            0,
            0,
            0
          ],
          "cleanseOnHealAbnormal": {
            "enabled": [
              0,
              0,
              0,
              0
            ],
            "priority": [
              "stun",
              "frozen",
              "cold",
              "sleep",
              "root",
              "sluggish",
              "silence"
            ],
            "maxRemove": 1,
            "excludes": [
              "activeSkill",
              "elementBurst"
            ]
          },
          "elementSlotMultiplier": [
            1,
            1,
            1,
            0.85
          ],
          "elementSlotMultiplierScope": "duringSelfGrantedResist"
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_finlpp"
      }
    ]
  },
  "char_199_yak": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "maxHp": [
              0.4,
              0.5,
              0.6,
              0.7
            ],
            "def": [
              0.3,
              0.4,
              0.5,
              0.6
            ],
            "res": [
              0.5,
              0.7,
              0.9,
              1
            ],
            "duration": [
              20,
              24,
              28,
              30
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_199_yak/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "resByStar": [
            5,
            8,
            12,
            15
          ],
          "duration": 6
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "magicDamageTaken",
        "target": "self",
        "params": {
          "res": [
            5,
            8,
            12,
            15
          ],
          "duration": [
            6,
            6,
            6,
            6
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_yak"
      }
    ]
  },
  "char_150_snakek": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "def": [
              0.95,
              1.1,
              1.3,
              1.5
            ],
            "blockCnt": [
              1,
              1,
              1,
              1
            ],
            "duration": [
              24,
              26,
              28,
              30
            ]
          }
        },
        {
          "index": 1,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "maxHpPerSec": [
              0.02,
              0.025,
              0.03,
              0.035
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_150_snakek/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "defByStar": [
            0.06,
            0.09,
            0.12,
            0.16
          ],
          "duration": 5
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "attacked",
        "target": "self",
        "params": {
          "def": [
            0.06,
            0.09,
            0.12,
            0.16
          ],
          "duration": [
            5,
            5,
            5,
            5
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_snakek"
      }
    ]
  },
  "char_381_bubble": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "status": 1,
            "tauntLevel": [
              1,
              1,
              1,
              1
            ],
            "def": [
              0.85,
              1,
              1.2,
              1.35
            ],
            "duration": [
              20,
              22,
              24,
              25
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "attackedWhileSkillActive",
          "target": "attacker",
          "params": {
            "defScale": [
              0.4,
              0.45,
              0.5,
              0.6
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_381_bubble/talents/0",
        "mode": "rewrite",
        "target": "attacker",
        "parameters": {
          "atkDown": [
            -0.05,
            -0.06,
            -0.08,
            -0.1
          ],
          "duration": 5
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "attacked",
        "target": "attacker",
        "params": {
          "atkDown": [
            -0.05,
            -0.06,
            -0.08,
            -0.1
          ],
          "duration": [
            5,
            5,
            5,
            5
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_bubble"
      }
    ]
  },
  "char_196_sunbr": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "nearbyAllies",
          "params": {
            "healScale": [
              1.3,
              1.55,
              1.8,
              2.1
            ],
            "targets": [
              1,
              1,
              2,
              2
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_196_sunbr/talents/0",
        "mode": "rewrite",
        "target": "hitTargets",
        "parameters": {
          "prob": [
            0.1,
            0.1,
            0.15,
            0.15
          ],
          "atkScale": [
            1.5,
            1.6,
            1.8,
            2
          ],
          "stun": [
            0.5,
            0.7,
            1,
            1.2
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "normalAttackHit",
        "target": "hitTargets",
        "params": {
          "prob": [
            0.1,
            0.1,
            0.15,
            0.15
          ],
          "scale": [
            1.5,
            1.6,
            1.8,
            2
          ],
          "stun": [
            0.5,
            0.7,
            1,
            1.2
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_sunbr"
      }
    ]
  },
  "char_128_plosis": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "allAllies",
          "params": {
            "healRatio": [
              1.2,
              1.5,
              1.8,
              2.2
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "allAllies",
          "params": {
            "attackSpeed": [
              60,
              90,
              120,
              150
            ],
            "duration": [
              10,
              12,
              14,
              16
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_128_plosis/talents/0",
        "mode": "rewrite",
        "target": "allAllies",
        "parameters": {
          "spPerSec": [
            0.3,
            0.4,
            0.5,
            0.6
          ],
          "duration": [
            8,
            8,
            10,
            10
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "skillSettled",
        "target": "allAllies",
        "params": {
          "spPerSec": [
            0.3,
            0.4,
            0.5,
            0.6
          ],
          "duration": [
            8,
            8,
            10,
            10
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_plosis"
      }
    ]
  },
  "char_4163_rosesa": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1.65,
              1.9,
              2.15,
              2.4
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4163_rosesa/talents/0",
        "mode": "rewrite",
        "target": "healedTargets",
        "parameters": {
          "selfAtk": -0.05,
          "healAmp": [
            0.1,
            0.12,
            0.15,
            0.18
          ],
          "duration": 8
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "healed",
        "target": "healedTargets",
        "params": {
          "healAmp": [
            0.1,
            0.12,
            0.15,
            0.18
          ],
          "duration": [
            8,
            8,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_rosesa"
      }
    ]
  },
  "char_102_texas": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              8,
              10,
              11,
              12
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
            "hits": [
              2,
              2,
              2,
              2
            ],
            "atkScale": [
              1.35,
              1.55,
              1.8,
              2
            ],
            "stun": [
              2,
              2,
              3,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_102_texas/talents/0",
        "mode": "retain",
        "target": "alliesAtBattleStart",
        "parameters": {
          "initCost": [
            1,
            1,
            2,
            2
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "economy",
        "trigger": "battleStart",
        "target": "allAllies",
        "params": {
          "initCost": [
            1,
            1,
            2,
            2
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_texas"
      }
    ]
  },
  "char_349_chiave": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              7,
              8,
              9,
              10
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
            "atkScale": [
              2.8,
              3,
              3.2,
              3.5
            ],
            "resDown": [
              -0.1,
              -0.12,
              -0.15,
              -0.2
            ],
            "duration": [
              7,
              7,
              8,
              8
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_349_chiave/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "atkPerDevice": [
            0.07,
            0.09,
            0.11,
            0.13
          ],
          "defPerDevice": [
            0.07,
            0.09,
            0.11,
            0.13
          ],
          "maxDevices": 2
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "self",
        "params": {
          "deviceId": "chiave_mech_claw",
          "count": [
            1,
            1,
            1,
            1
          ],
          "duration": [
            30,
            35,
            40,
            45
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_chiave"
      }
    ]
  },
  "char_496_wildmn": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "forwardLineEnemies",
          "params": {
            "atkScale": [
              2,
              2.4,
              2.8,
              3.2
            ],
            "maxTargets": [
              3,
              3,
              4,
              4
            ]
          }
        },
        {
          "index": 1,
          "action": "move",
          "trigger": "skillResolve",
          "target": "frontRangeEnemies",
          "params": {
            "forceLevel": [
              1,
              1,
              1,
              2
            ],
            "distance": [
              1,
              1,
              1,
              2
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_496_wildmn/talents/0",
        "mode": "rewrite",
        "target": "nextDeployCost",
        "parameters": {
          "costReduce": [
            1,
            1,
            1,
            2
          ],
          "maxPerBattle": 5
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "economy",
        "trigger": "enemyKilled",
        "target": "selfEconomy",
        "params": {
          "costReduce": [
            1,
            1,
            1,
            2
          ],
          "maxPerBattle": [
            5,
            5,
            5,
            5
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_wildmn"
      }
    ]
  },
  "char_401_elysm": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              12,
              14,
              16,
              18
            ]
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
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
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_401_elysm/talents/0",
        "mode": "rewrite",
        "target": "allSniperAllies",
        "parameters": {
          "attackSpeed": [
            10,
            15,
            20,
            25
          ],
          "duration": 8
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "skillSettled",
        "target": "allAlliesSniper",
        "params": {
          "attackSpeed": [
            10,
            15,
            20,
            25
          ],
          "duration": [
            8,
            8,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_elysm"
      }
    ]
  },
  "char_4119_wanqin": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              12,
              14,
              16,
              18
            ]
          }
        },
        {
          "index": 1,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "adjacentAllies",
          "params": {
            "healScale": [
              0.2,
              0.22,
              0.25,
              0.3
            ]
          }
        },
        {
          "index": 2,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "sameFacingAdjacentAllies",
          "params": {
            "attackSpeed": [
              20,
              22,
              25,
              30
            ],
            "duration": [
              8,
              9,
              10,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4119_wanqin/talents/0",
        "mode": "rewrite",
        "target": "adjacentAllies",
        "parameters": {
          "maxHp": [
            0.03,
            0.04,
            0.05,
            0.06
          ],
          "maxHpSameDir": [
            0.05,
            0.07,
            0.09,
            0.11
          ],
          "duration": 10
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "skillSettled",
        "target": "adjacentAllies",
        "params": {
          "maxHp": [
            0.03,
            0.04,
            0.05,
            0.06
          ],
          "maxHpSameDir": [
            0.05,
            0.07,
            0.09,
            0.11
          ],
          "duration": [
            10,
            10,
            10,
            10
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_wanqin"
      }
    ]
  },
  "char_497_ctable": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "ammo",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "rounds": [
              12,
              15,
              18,
              22
            ],
            "atk": [
              0.28,
              0.32,
              0.36,
              0.4
            ],
            "attackSpeed": [
              34,
              40,
              45,
              50
            ],
            "stealth": [
              1,
              1,
              1,
              1
            ]
          }
        },
        {
          "index": 1,
          "action": "economy",
          "trigger": "ammoAttackHit",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_497_ctable/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "attackSpeed": [
            6,
            9,
            12,
            15
          ],
          "atk": [
            0.06,
            0.09,
            0.12,
            0.15
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "economy",
        "trigger": "ammoAttackHit",
        "target": "selfEconomy",
        "params": {
          "costGain": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_ctable"
      }
    ]
  },
  "char_4017_puzzle": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "rangeEnemies",
          "params": {
            "dotScale": [
              0.12,
              0.13,
              0.15,
              0.16
            ],
            "maxStacks": [
              10,
              10,
              10,
              10
            ],
            "duration": [
              16,
              16,
              16,
              16
            ],
            "maxTargets": [
              1,
              2,
              2,
              2
            ]
          }
        },
        {
          "index": 1,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              2,
              2,
              3,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4017_puzzle/talents/0",
        "mode": "rewrite",
        "target": "hitFullHpEnemy",
        "parameters": {
          "atkScale": [
            1.1,
            1.15,
            1.2,
            1.25
          ],
          "spGain": [
            1,
            1,
            2,
            2
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "hitFullHpEnemy",
        "target": "self",
        "params": {
          "spGain": [
            1,
            1,
            2,
            2
          ],
          "atkScale": [
            1.1,
            1.15,
            1.2,
            1.25
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_puzzle"
      }
    ]
  },
  "char_108_silent": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "summon",
          "trigger": "skillResolve",
          "target": "frontCell",
          "params": {
            "deviceId": "silent_medic_drone",
            "duration": [
              10,
              12,
              14,
              16
            ],
            "healScale": [
              0.6,
              0.75,
              0.9,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_108_silent/talents/0",
        "mode": "rewrite",
        "target": "allMedicAllies",
        "parameters": {
          "attackSpeed": [
            6,
            9,
            12,
            15
          ],
          "duration": 8
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "skillSummon",
        "target": "allAlliesMedic",
        "params": {
          "attackSpeed": [
            6,
            9,
            12,
            15
          ],
          "duration": [
            8,
            8,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_silent"
      }
    ]
  },
  "char_171_bldsk": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "selfAndRandomRangeAlly",
          "params": {
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
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "buffedUnits",
          "params": {
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
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_171_bldsk/talents/0",
        "mode": "rewrite",
        "target": "selfAndRandomRangeAlly",
        "parameters": {
          "spGain": [
            1,
            1,
            2,
            2
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "enemyKilledInRange",
        "target": "selfAndRandomRangeAlly",
        "params": {
          "spGain": [
            1,
            1,
            2,
            2
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_bldsk"
      }
    ]
  },
  "char_4196_reckpr": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1.3,
              1.45,
              1.55,
              1.7
            ],
            "targets": [
              2,
              2,
              2,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4196_reckpr/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "spGain": [
            1,
            1,
            1,
            2
          ],
          "attackSpeed": [
            8,
            12,
            16,
            20
          ],
          "duration": 8
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "allySkillInRange",
        "target": "self",
        "params": {
          "spGain": [
            1,
            1,
            1,
            2
          ],
          "attackSpeed": [
            8,
            12,
            16,
            20
          ],
          "duration": [
            8,
            8,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_reckpr"
      }
    ]
  },
  "char_4114_harold": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "mostElementDamagedAlly",
          "params": {
            "healScale": [
              1.6,
              1.8,
              2,
              2.3
            ],
            "epHealScale": [
              0.75,
              0.9,
              1.05,
              1.25
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "attackSpeed": [
              80,
              90,
              100,
              110
            ],
            "duration": [
              8,
              9,
              10,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4114_harold/talents/0",
        "mode": "rewrite",
        "target": "rangeAlliesElementOverHalf",
        "parameters": {
          "epResistance": [
            0.12,
            0.13,
            0.15,
            0.18
          ],
          "reductionTarget": "elementSlotAccumulation",
          "thresholdRatio": 0.5,
          "perSlot": true,
          "anySlot": true,
          "cancelOnLeaveRange": true,
          "cancelOnBelowThreshold": true
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "allyElementThreshold",
        "target": "eventAlly",
        "params": {
          "epResistance": [
            0.12,
            0.13,
            0.15,
            0.18
          ],
          "reductionTarget": "elementSlotAccumulation",
          "thresholdRatio": 0.5,
          "perSlot": true,
          "anySlot": true,
          "cancelOnLeaveRange": true,
          "cancelOnBelowThreshold": true
        }
      },
      {
        "index": 1,
        "action": "heal",
        "trigger": "coveredAllyElementBurst",
        "target": "eventAlly",
        "params": {
          "unlockStar": 4,
          "onlyFirstInstantHpDamage": true,
          "healEqualsActualHpDamage": true,
          "appliesAfterMitigation": true,
          "capByMissingHp": true,
          "keepBurstDebuffAndDot": true,
          "cancelWholeBurst": false,
          "multiplyBy5": false,
          "countFullHpHealAsNetHeal": false,
          "independentSlots": true
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_harold"
      }
    ]
  },
  "char_494_vendla": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "highestMaxHpRangeAlly",
          "params": {
            "tauntLevel": [
              1,
              1,
              1,
              1
            ],
            "atk": [
              0.75,
              0.8,
              0.85,
              0.9
            ],
            "duration": [
              15,
              16,
              17,
              18
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "shelteredAllyAttacked",
          "target": "attacker",
          "params": {
            "dmgType": "arts",
            "atkScale": [
              0.3,
              0.4,
              0.5,
              0.6
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_494_vendla/talents/0",
        "mode": "rewrite",
        "target": "highestMaxHpRangeAlly",
        "parameters": {
          "healAmp": [
            0.08,
            0.1,
            0.15,
            0.18
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "highestMaxHpAllyHealed",
        "target": "eventAlly",
        "params": {
          "healReceived": [
            0.08,
            0.1,
            0.15,
            0.18
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_vendla"
      }
    ]
  },
  "char_4139_papyrs": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "highestMaxHpAllyAndJumps",
          "params": {
            "healScale": [
              1.75,
              1.9,
              2,
              2.2
            ],
            "chainJumps": [
              3,
              3,
              4,
              4
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillHeal",
          "target": "healedTargets",
          "params": {
            "barrierScale": [
              0.2,
              0.25,
              0.3,
              0.35
            ],
            "duration": [
              8,
              8,
              8,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4139_papyrs/talents/0",
        "mode": "retain",
        "target": "healedTargets",
        "parameters": {
          "barrierScale": [
            0.05,
            0.1,
            0.2,
            0.28
          ],
          "duration": 8
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "healed",
        "target": "healedTargets",
        "params": {
          "barrierScale": [
            0.05,
            0.1,
            0.2,
            0.28
          ],
          "duration": [
            8,
            8,
            8,
            8
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_papyrs"
      }
    ]
  },
  "char_4222_taraxa": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "injuredRangeAllies",
          "params": {
            "healScale": [
              0.5,
              0.52,
              0.55,
              0.6
            ],
            "hits": [
              4,
              5,
              5,
              6
            ]
          }
        },
        {
          "index": 1,
          "action": "nativeMechanism",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "mechanism": "扶风",
            "attackSpeed": [
              60,
              80,
              100,
              120
            ],
            "duration": [
              12,
              14,
              16,
              18
            ],
            "canHealFlying": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4222_taraxa/talents/0",
        "mode": "rewrite",
        "target": "rangeAlliesDuringWind",
        "parameters": {
          "damageResistance": [
            0.07,
            0.08,
            0.1,
            0.12
          ],
          "blockCnt": 1
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "enterFengState",
        "target": "rangeAllies",
        "params": {
          "damageResistance": [
            0.07,
            0.08,
            0.1,
            0.12
          ],
          "blockCnt": [
            1,
            1,
            1,
            1
          ],
          "duration": [
            12,
            14,
            16,
            18
          ]
        }
      }
    ],
    "modules": []
  },
  "char_107_liskam": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
            "dmgType": "arts",
            "atkScale": [
              1.25,
              1.5,
              1.75,
              2
            ],
            "maxTargets": [
              3,
              3,
              4,
              4
            ],
            "stunProb": [
              0.2,
              0.22,
              0.25,
              0.3
            ],
            "stun": [
              1,
              1,
              1,
              1
            ]
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "stun": [
              3,
              4,
              5,
              5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_107_liskam/talents/0",
        "mode": "retain",
        "target": "selfAndRandomAdjacentAlly",
        "parameters": {
          "spGain": 1
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_107_liskam/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "res": 10
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "skillResolve",
        "target": "selfAndRandomAdjacentAlly",
        "params": {
          "spGain": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_liskam"
      }
    ]
  },
  "char_4137_udflow": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "forwardLineEnemies",
          "params": {
            "dmgType": "arts",
            "atkScale": [
              0.5,
              0.55,
              0.6,
              0.7
            ],
            "maxTargets": [
              3,
              3,
              4,
              4
            ],
            "sluggish": [
              1,
              1,
              1,
              1.5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4137_udflow/talents/0",
        "mode": "rewrite",
        "target": "hitTargets",
        "parameters": {
          "dotPerSec": [
            40,
            55,
            80,
            100
          ],
          "duration": 3,
          "seamonsterMultiplier": 2
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "attackHit",
        "target": "hitTargets",
        "params": {
          "dotPerSec": [
            40,
            55,
            80,
            100
          ],
          "duration": [
            3,
            3,
            3,
            3
          ],
          "seamonsterMultiplier": [
            2,
            2,
            2,
            2
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_udflow"
      }
    ]
  },
  "char_4207_branch": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "adjacentGroundEnemies",
          "params": {
            "status": 1,
            "fear": [
              5,
              5,
              5,
              5
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              1.2,
              1.35,
              1.5,
              1.7
            ],
            "def": [
              0.4,
              0.45,
              0.5,
              0.55
            ],
            "duration": [
              15,
              15,
              15,
              15
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4207_branch/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "hpRatio": [
            0.4,
            0.45,
            0.5,
            0.55
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "heal",
        "trigger": "skillSettled",
        "target": "self",
        "params": {
          "maxHpRatio": [
            0.4,
            0.45,
            0.5,
            0.55
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_branch"
      }
    ]
  },
  "char_431_ashlok": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "frontAreaEnemies",
          "params": {
            "atkScale": [
              1.4,
              1.6,
              1.85,
              2.1
            ],
            "splash": [
              1,
              1,
              1,
              1
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "blockCnt": [
              -1,
              -1,
              -1,
              -1
            ],
            "attackInterval": [
              -0.5,
              -0.55,
              -0.6,
              -0.65
            ],
            "duration": [
              10,
              10,
              10,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_431_ashlok/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "atk": [
            0.08,
            0.1,
            0.12,
            0.14
          ],
          "atkOnGround": [
            0.16,
            0.2,
            0.24,
            0.28
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "attack",
        "target": "self",
        "params": {
          "atk": [
            0.08,
            0.1,
            0.12,
            0.14
          ],
          "atkOnGround": [
            0.16,
            0.2,
            0.24,
            0.28
          ],
          "duration": [
            4,
            4,
            4,
            4
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_ashlok"
      }
    ]
  },
  "char_4148_philae": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "maxHp": [
              0.6,
              0.7,
              0.8,
              0.9
            ],
            "epBarrier": [
              1200,
              1400,
              1600,
              1800
            ],
            "duration": [
              15,
              15,
              15,
              15
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4148_philae/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "epResistance": [
            0.05,
            0.07,
            0.1,
            0.12
          ],
          "spGain": [
            1,
            1,
            2,
            2
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "decayDamageTaken",
        "target": "self",
        "params": {
          "spGain": [
            1,
            1,
            2,
            2
          ],
          "epResistance": [
            0.05,
            0.07,
            0.1,
            0.12
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_philae"
      }
    ]
  },
  "char_112_siege": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
            "atkScale": [
              2.8,
              3,
              3.2,
              3.4
            ]
          }
        },
        {
          "index": 1,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              2,
              3,
              3,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_112_siege/talents/0",
        "mode": "retain",
        "target": "allPioneerAllies",
        "parameters": {
          "atk": [
            0.06,
            0.07,
            0.08,
            0.09
          ],
          "def": [
            0.06,
            0.07,
            0.08,
            0.09
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_112_siege/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "spGain": 1
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "enemyKilledAdjacent",
        "target": "self",
        "params": {
          "spGain": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_siege"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_siege"
      }
    ]
  },
  "char_222_bpipe": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "attackTargets",
          "params": {
            "atkScale": [
              1.6,
              1.8,
              2,
              2.2
            ],
            "extraHits": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_222_bpipe/talents/0",
        "mode": "retain",
        "target": "attackTargets",
        "parameters": {
          "prob": [
            0.25,
            0.25,
            0.25,
            0.25
          ],
          "atkScale": [
            1.1,
            1.15,
            1.3,
            1.4
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_222_bpipe/talents/1",
        "mode": "retain",
        "target": "allPioneerAllies",
        "parameters": {
          "initSp": [
            4,
            5,
            6,
            7
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "battleStart",
        "target": "allAlliesPioneer",
        "params": {
          "initSp": [
            4,
            5,
            6,
            7
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_bpipe"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_bpipe"
      }
    ]
  },
  "char_4026_vulpis": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "attackTargets",
          "params": {
            "targets": 1,
            "dmgType": "arts",
            "atkScale": [
              2.45,
              2.6,
              2.75,
              2.9
            ]
          }
        },
        {
          "index": 1,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4026_vulpis/talents/0",
        "mode": "retain",
        "target": "eventEnemy",
        "parameters": {
          "extraScale": [
            0.2,
            0.24,
            0.3,
            0.34
          ],
          "duration": 10,
          "killCostGain": [0, 0, 0, 2]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4026_vulpis/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "costRate": [
            1.08,
            1.09,
            1.1,
            1.12
          ],
          "hpPerSec": [
            0.03,
            0.035,
            0.04,
            0.045
          ],
          "interval": 4
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "firstDamageToEnemy",
        "target": "eventEnemy",
        "params": {
          "extraScale": [
            0.2,
            0.24,
            0.3,
            0.34
          ],
          "duration": [
            10,
            10,
            10,
            10
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_vulpis"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_vulpis"
      }
    ]
  },
  "char_479_sleach": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              8,
              9,
              10,
              10
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "bannerLandingEnemies",
          "params": {
            "atkScale": [
              2.4,
              2.7,
              3,
              3.2
            ],
            "stun": [
              3,
              3,
              3.5,
              3.5
            ],
            "slow": [
              1,
              1,
              1,
              1
            ],
            "fragile": [
              0.25,
              0.28,
              0.3,
              0.35
            ],
            "duration": [
              10,
              10,
              10,
              10
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_479_sleach/talents/0",
        "mode": "rewrite",
        "target": "bannerArea",
        "parameters": {
          "allyAttackSpeed": [
            5,
            8,
            10,
            12
          ],
          "enemyAttackSpeed": [
            -5,
            -8,
            -10,
            -12
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_479_sleach/talents/1",
        "mode": "retain",
        "target": "nextDeployedAlly",
        "parameters": {
          "nextCost": [
            -2,
            -2,
            -2,
            -2
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "self",
        "params": {
          "deviceId": "sleach_banner",
          "count": [
            1,
            1,
            1,
            1
          ],
          "duration": [
            0,
            0,
            0,
            0
          ],
          "allyAttackSpeed": [
            5,
            8,
            10,
            12
          ],
          "enemyAttackSpeed": [
            -5,
            -8,
            -10,
            -12
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_sleach"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_sleach"
      }
    ]
  },
  "char_420_flamtl": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              6,
              7,
              7,
              8
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              0.6,
              0.7,
              0.8,
              0.9
            ],
            "blockCnt": [
              1,
              1,
              1,
              1
            ],
            "dodge": [
              0.8,
              0.8,
              0.8,
              0.8
            ],
            "duration": [
              8,
              8,
              8,
              8
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_420_flamtl/talents/0",
        "mode": "rewrite",
        "target": "nextAttack",
        "parameters": {
          "extraHits": 1,
          "targetAllBlocked": 1
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_420_flamtl/talents/1",
        "mode": "retain",
        "target": "allKazimierzAllies",
        "parameters": {
          "physDodge": [
            0.14,
            0.18,
            0.22,
            0.26
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "dodge",
        "target": "self",
        "params": {
          "nextAttackMulti": [
            2,
            2,
            2,
            2
          ],
          "targetAllBlocked": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_flamtl"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_flamtl"
      }
    ]
  },
  "char_427_vigil": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              5,
              6,
              6,
              7
            ]
          }
        },
        {
          "index": 1,
          "action": "summon",
          "trigger": "skillResolve",
          "target": "ownedWolfSummons",
          "params": {
            "wolfShadows": [
              1,
              1,
              1,
              1
            ],
            "maxShadows": 3
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_427_vigil/talents/0",
        "mode": "retain",
        "target": "tacticalWolfPoint",
        "parameters": {
          "interval": [
            30,
            27,
            25,
            23
          ],
          "maxShadows": 3
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_427_vigil/talents/1",
        "mode": "retain",
        "target": "wolfBlockedEnemy",
        "parameters": {
          "defPenetrate": [
            125,
            150,
            175,
            200
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "tacticalPoint",
        "params": {
          "deviceId": "vigil_wolfpack",
          "shadows": [
            2,
            2,
            2,
            2
          ],
          "maxShadows": 3,
          "blockPerShadow": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_vigil"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_vigil"
      }
    ]
  },
  "char_249_mlyss": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "economy",
          "trigger": "skillResolve",
          "target": "selfEconomy",
          "params": {
            "costGain": [
              10,
              12,
              14,
              15
            ]
          }
        },
        {
          "index": 1,
          "action": "nativeMechanism",
          "trigger": "skillResolve",
          "target": "selfAndFlowshapes",
          "params": {
            "mechanism": "浅层非熵适应",
            "atk": [
              0.35,
              0.4,
              0.45,
              0.5
            ],
            "duration": [
              15,
              15,
              15,
              15
            ],
            "meleeDragInterval": [
              2,
              2,
              2,
              2
            ],
            "meleeDragForce": [
              1,
              1,
              1,
              2
            ],
            "rangeRoot": [
              1.5,
              1.5,
              1.5,
              1.5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_249_mlyss/talents/0",
        "mode": "retain",
        "target": "tacticalFlowshapePoint",
        "parameters": {
          "refreshSec": [
            30,
            28,
            25,
            22
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_249_mlyss/talents/1",
        "mode": "retain",
        "target": "allRhineAllies",
        "parameters": {
          "cost": [
            -2,
            -2,
            -2,
            -2
          ],
          "firstExtra": [
            -1,
            -1,
            -1,
            -1
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "tacticalPoint",
        "params": {
          "deviceId": "mlyss_flowshape",
          "refreshSec": [
            30,
            28,
            25,
            22
          ],
          "copyFields": [
            "maxHp",
            "atk",
            "def",
            "res",
            "blockCnt",
            "attackInterval",
            "rangeId",
            "dmgType"
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_mlyss"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_mlyss"
      }
    ]
  },
  "char_1045_svash2": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "frontAreaEnemies",
          "params": {
            "atkScale": [
              3.2,
              3.5,
              3.8,
              4
            ],
            "maxTargets": [
              6,
              6,
              6,
              6
            ],
            "cold": [
              5,
              5,
              6,
              6
            ],
            "reveal": [
              1,
              1,
              1,
              1
            ]
          }
        },
        {
          "index": 1,
          "action": "redeploy",
          "trigger": "skillResolve",
          "target": "highestDpEligibleAlly",
          "params": {
            "costReduce": [
              5,
              5,
              5,
              5
            ],
            "immediateSkill": [
              1,
              1,
              1,
              1
            ],
            "maxTargets": [
              1,
              1,
              1,
              1
            ],
            "includeSelf": [
              1,
              1,
              1,
              1
            ],
            "immediateSkillOnce": [
              1,
              1,
              1,
              1
            ],
            "extraCastRedeployDisabled": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_1045_svash2/talents/0",
        "mode": "rewrite",
        "target": "leftOfEyeAndSelf",
        "parameters": {
          "initSp": [
            2,
            3,
            4,
            5
          ],
          "respawnTimeMultiplier": [
            0.9,
            0.85,
            0.8,
            0.75
          ],
          "anchorName": "风雪之眼",
          "anchorKind": "deployAnchor",
          "anchorCombatant": false,
          "anchorPopulation": 0,
          "anchorAttackable": false,
          "anchorHealable": false,
          "deploySort": {
            "key": "currentBattleDeployCost",
            "order": "asc",
            "tieBreak": "formationOrder"
          },
          "affectSide": "anchorLeft",
          "initSpTiming": "naturalDeployInitOnly",
          "initSpNotOnSurvivingRedeploy": true,
          "respawnAppliesTo": "nextRedeployMultiplier"
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/1",
        "mode": "rewrite",
        "target": "allKjeragAllies",
        "parameters": {
          "freezeImmune": true,
          "freezeImmuneDoesNotCountAsApplied": true,
          "def": [
            60,
            70,
            80,
            90
          ],
          "hpPerSec": [
            0.015,
            0.018,
            0.02,
            0.022
          ],
          "hpPerSecIsMaxHpRatio": true,
          "hpHealAppliedMultiplier": 1,
          "rampSec": 15,
          "rampMultiplier": 2,
          "auraScope": "inFieldShelag",
          "auraProvidedWhile": "selfAliveAndDeployed",
          "auraRevokedOnExit": true,
          "rampRestartOnReentry": true,
          "noRampResetOnSurvivingRedeploy": true,
          "auraKeepaliveEmitsStatus": false
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/2",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/3",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/4",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/5",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/6",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1045_svash2/talents/7",
        "mode": "retain",
        "target": "none",
        "parameters": {},
        "binding": "none",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "haste",
        "trigger": "allyRedeploy",
        "target": "self",
        "params": {
          "spRegenBonus": [
            1,
            1,
            1,
            1
          ],
          "duration": [
            2,
            2,
            2.5,
            3
          ]
        }
      }
    ],
    "modules": []
  },
  "char_4087_ines": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              0.8,
              0.9,
              1.1,
              1.3
            ],
            "stealth": [
              1,
              1,
              1,
              1
            ],
            "duration": [
              12,
              12,
              12,
              12
            ]
          }
        },
        {
          "index": 1,
          "action": "nativeMechanism",
          "trigger": "attackHitWhileSkillActive",
          "target": "hitTargets",
          "params": {
            "mechanism": "偷取攻速",
            "stealAttackSpeed": [
              7,
              8,
              9,
              10
            ],
            "maxSteal": [
              60,
              65,
              70,
              80
            ],
            "costGain": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4087_ines/talents/0",
        "mode": "retain",
        "target": "eventEnemy",
        "parameters": {
          "stealAtk": [
            50,
            70,
            90,
            110
          ],
          "root": [
            3,
            4,
            5,
            5
          ],
          "maxSteal": [
            10000,
            14000,
            18000,
            22000
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4087_ines/talents/1",
        "mode": "retain",
        "target": "rangeEnemiesAndSentry",
        "parameters": {
          "slow": [
            -0.3,
            -0.32,
            -0.3,
            -0.35
          ],
          "maxScouts": 1
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "firstDamageToEnemy",
        "target": "eventEnemy",
        "params": {
          "root": [
            3,
            4,
            5,
            5
          ],
          "stealAtk": [
            50,
            70,
            90,
            110
          ],
          "maxSteal": [
            10000,
            14000,
            18000,
            22000
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_ines"
      }
    ]
  },
  "char_4042_lumen": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              2,
              2.3,
              2.6,
              3
            ],
            "maxTargets": [
              2,
              2,
              3,
              3
            ],
            "cleanse": [
              1,
              1,
              1,
              1
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4042_lumen/talents/0",
        "mode": "retain",
        "target": "healedTargets",
        "parameters": {
          "resistSec": [
            2,
            3,
            4,
            5
          ],
          "highHpResistSec": [
            4,
            5,
            6,
            7
          ],
          "hpRatio": 0.75
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4042_lumen/talents/1",
        "mode": "rewrite",
        "target": "alliedWithStatus",
        "parameters": {
          "healScale": [
            0.8,
            0.9,
            1,
            1.1
          ],
          "cooldown": 12
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "heal",
        "trigger": "allyStatusInRange",
        "target": "eventAlly",
        "params": {
          "healScale": [
            0.8,
            0.9,
            1,
            1.1
          ],
          "cooldown": [
            12,
            12,
            12,
            12
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_lumen"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_lumen"
      }
    ]
  },
  "char_1016_agoat2": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1.5,
              1.8,
              2.1,
              2.5
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "epBarrierScale": [
              6.5,
              7.5,
              9,
              11
            ],
            "duration": [
              14,
              16,
              18,
              20
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_1016_agoat2/talents/0",
        "mode": "rewrite",
        "target": "healedTargets",
        "parameters": {
          "regenScale": [
            0.08,
            0.09,
            0.1,
            0.12
          ],
          "duration": [
            4,
            5,
            6,
            6
          ],
          "maxStacks": 3
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1016_agoat2/talents/1",
        "mode": "retain",
        "target": "rangeAllies",
        "parameters": {
          "maxHp": [
            0.04,
            0.05,
            0.06,
            0.07
          ],
          "epDamageResistance": [
            0.08,
            0.1,
            0.12,
            0.14
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "normalHeal",
        "target": "healedTargets",
        "params": {
          "regenScale": [
            0.08,
            0.09,
            0.1,
            0.12
          ],
          "duration": [
            4,
            5,
            6,
            6
          ],
          "maxStacks": [
            3,
            3,
            3,
            3
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_agoat2"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_agoat2"
      }
    ]
  },
  "char_1020_reed2": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "nativeMechanism",
          "trigger": "skillResolve",
          "target": "rangeGroundAllies",
          "params": {
            "mechanism": "火种",
            "maxTargets": [
              2,
              2,
              2,
              2
            ],
            "interval": [
              1.5,
              1.5,
              1.5,
              1.5
            ],
            "atkScale": [
              1.9,
              2,
              2.2,
              2.4
            ],
            "duration": [
              20,
              20,
              20,
              20
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_1020_reed2/talents/0",
        "mode": "retain",
        "target": "damagedEnemy",
        "parameters": {
          "prob": [
            0.3,
            0.3,
            0.3,
            0.3
          ],
          "atkDown": [
            -0.1,
            -0.15,
            -0.2,
            -0.24
          ],
          "magicFragile": [
            0.15,
            0.2,
            0.3,
            0.34
          ],
          "duration": 6
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1020_reed2/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "selfHealScale": [
            0.4,
            0.45,
            0.5,
            0.55
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "applyStatus",
        "trigger": "damageDealt",
        "target": "damagedEnemy",
        "params": {
          "prob": [
            0.3,
            0.3,
            0.3,
            0.3
          ],
          "atkDown": [
            -0.1,
            -0.15,
            -0.2,
            -0.24
          ],
          "magicFragile": [
            0.15,
            0.2,
            0.3,
            0.34
          ],
          "duration": [
            6,
            6,
            6,
            6
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_reed2"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_reed2"
      }
    ]
  },
  "char_4056_titi": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "rangeEnemies",
          "params": {
            "atkScale": [
              0.8,
              0.9,
              1,
              1.1
            ]
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "hitTargets",
          "params": {
            "prob": [
              0.4,
              0.45,
              0.5,
              0.5
            ],
            "sleep": [
              2.4,
              2.6,
              3,
              3
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4056_titi/talents/0",
        "mode": "retain",
        "target": "attackerAndSleepingEnemy",
        "parameters": {
          "extraAtkScale": [
            0.1,
            0.12,
            0.15,
            0.18
          ],
          "sleepDotScale": [
            0.18,
            0.22,
            0.3,
            0.35
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4056_titi/talents/1",
        "mode": "retain",
        "target": "minoSargonAllies",
        "parameters": {
          "attackSpeed": [
            12,
            16,
            20,
            24
          ],
          "hpRatio": 0.5
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "enemySleepPresent",
        "target": "sleepingEnemies",
        "params": {
          "dotScale": [
            0.18,
            0.22,
            0.3,
            0.35
          ],
          "interval": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_titi"
      }
    ]
  },
  "char_4179_monstr": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1.7,
              1.85,
              2,
              2.2
            ],
            "chainJumps": [
              4,
              4,
              5,
              5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4179_monstr/talents/0",
        "mode": "retain",
        "target": "reconstructionAndNearbyAllies",
        "parameters": {
          "alliesAtk": [
            0.03,
            0.05,
            0.1,
            0.15
          ],
          "maxTokens": 1
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4179_monstr/talents/1",
        "mode": "retain",
        "target": "healedTargetAndSelf",
        "parameters": {
          "attackSpeed": [
            10,
            14,
            20,
            24
          ],
          "duration": 10
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "rangeGroundTiles",
        "params": {
          "deviceId": "monstr_reconstruction",
          "count": [
            1,
            1,
            1,
            1
          ],
          "onlySelfHeal": [
            1,
            1,
            1,
            1
          ],
          "alliesAtk": [
            0.03,
            0.05,
            0.1,
            0.15
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_monstr"
      }
    ]
  },
  "char_136_hsguma": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "frontCellEnemies",
          "params": {
            "atkScale": [
              1.4,
              1.6,
              1.8,
              2
            ]
          }
        },
        {
          "index": 1,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              0.4,
              0.5,
              0.6,
              0.7
            ],
            "def": [
              0.7,
              0.8,
              0.9,
              1
            ],
            "duration": [
              20,
              22,
              25,
              25
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_136_hsguma/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "damageBlock": [
            0.12,
            0.16,
            0.25,
            0.3
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_136_hsguma/talents/1",
        "mode": "retain",
        "target": "allDefenders",
        "parameters": {
          "def": [
            0.04,
            0.05,
            0.06,
            0.07
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "skillResolve",
        "target": "attacker",
        "params": {
          "atkScale": [
            0.8,
            0.9,
            1,
            1.1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_hsguma"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_hsguma"
      }
    ]
  },
  "char_202_demkni": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "nearbyAllies",
          "params": {
            "healScale": [
              1.1,
              1.25,
              1.4,
              1.6
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_202_demkni/talents/0",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "atk": [
            0.02,
            0.035,
            0.05,
            0.06
          ],
          "def": [
            0.02,
            0.03,
            0.04,
            0.05
          ],
          "interval": 20,
          "maxStacks": 5
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_202_demkni/talents/1",
        "mode": "retain",
        "target": "healedTargets",
        "parameters": {
          "spGain": [
            1,
            1,
            1,
            1
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "healed",
        "target": "healedTargets",
        "params": {
          "spGain": [
            1,
            1,
            1,
            1
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_demkni"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_demkni"
      }
    ]
  },
  "char_423_blemsh": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "attackTargets",
          "params": {
            "atkScale": [
              2.2,
              2.4,
              2.6,
              2.8
            ]
          }
        },
        {
          "index": 1,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "oneAdjacentAlly",
          "params": {
            "healScale": [
              1.2,
              1.3,
              1.5,
              1.7
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_423_blemsh/talents/0",
        "mode": "retain",
        "target": "allAllies",
        "parameters": {
          "spGain": [
            1,
            1,
            1,
            1
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_423_blemsh/talents/1",
        "mode": "retain",
        "target": "sleepingEnemies",
        "parameters": {
          "atkScale": [
            1.2,
            1.3,
            1.4,
            1.5
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "hitSleepingEnemy",
        "target": "hitTargets",
        "params": {
          "atkScale": [
            1.2,
            1.3,
            1.4,
            1.5
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_blemsh"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_blemsh"
      }
    ]
  },
  "char_2025_shu": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "rangeAllies",
          "params": {
            "healScale": [
              1.5,
              1.7,
              1.9,
              2.2
            ],
            "maxTargets": [
              2,
              2,
              2,
              2
            ]
          }
        },
        {
          "index": 1,
          "action": "device",
          "trigger": "skillResolve",
          "target": "healedAndAdjacentAllies",
          "params": {
            "deviceId": "shu_seed_plot",
            "hpPerSec": [
              70,
              90,
              110,
              130
            ],
            "protect": [
              0.1,
              0.12,
              0.15,
              0.18
            ],
            "duration": [
              12,
              14,
              16,
              18
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_2025_shu/talents/0",
        "mode": "rewrite",
        "target": "healedAndAdjacentAllies",
        "parameters": {
          "hpPerSec": [
            40,
            55,
            70,
            85
          ],
          "protect": [
            0.05,
            0.08,
            0.1,
            0.12
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_2025_shu/talents/1",
        "mode": "retain",
        "target": "alliesWithRosterCondition",
        "parameters": {
          "maxHp": [
            0.06,
            0.08,
            0.12,
            0.14
          ],
          "attackSpeed": [
            6,
            8,
            12,
            15
          ],
          "atk": [
            0.06,
            0.08,
            0.12,
            0.15
          ],
          "spInterval": 4
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "device",
        "trigger": "allyHealed",
        "target": "healedAndAdjacentAllies",
        "params": {
          "deviceId": "shu_seed_plot",
          "hpPerSec": [
            40,
            55,
            70,
            85
          ],
          "protect": [
            0.05,
            0.08,
            0.1,
            0.12
          ],
          "duration": [
            10,
            12,
            14,
            16
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_shu"
      }
    ]
  },
  "char_311_mudrok": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "heal",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "maxHpRatio": [
              0.05,
              0.055,
              0.06,
              0.07
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentGroundEnemies",
          "params": {
            "atkScale": [
              2.1,
              2.4,
              2.7,
              3
            ],
            "stunProb": [
              0.3,
              0.3,
              0.3,
              0.3
            ],
            "stun": [
              0.6,
              0.9,
              1.2,
              1.4
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_311_mudrok/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "interval": 9,
          "maxShields": [
            2,
            2,
            3,
            3
          ],
          "breakHeal": [
            0.15,
            0.2,
            0.2,
            0.25
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_311_mudrok/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "sarkazDamageResistance": [
            0.2,
            0.25,
            0.3,
            0.35
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "heal",
        "trigger": "shieldBroken",
        "target": "self",
        "params": {
          "maxHpRatio": [
            0.15,
            0.2,
            0.2,
            0.25
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_mudrok"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_mudrok"
      }
    ]
  },
  "char_4065_judge": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "attackTargets",
          "params": {
            "atkScale": [
              1.8,
              1.9,
              2,
              2.2
            ]
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "hitTargets",
          "params": {
            "stun": [
              3,
              3,
              4,
              5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4065_judge/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "bornBarrier": [
            0.3,
            0.4,
            0.5,
            0.55
          ],
          "killBarrier": [
            0.06,
            0.08,
            0.1,
            0.12
          ],
          "maxBarrier": 3
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4065_judge/talents/1",
        "mode": "retain",
        "target": "attacker",
        "parameters": {
          "counterScale": [
            0.4,
            0.45,
            0.5,
            0.55
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "damage",
        "trigger": "attackedWithOwnBarrier",
        "target": "attacker",
        "params": {
          "counterScale": [
            0.4,
            0.45,
            0.5,
            0.55
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_judge"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_judge"
      }
    ]
  },
  "char_416_zumama": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "blockedEnemies",
          "params": {
            "atkScale": [
              1.3,
              1.5,
              1.8,
              2
            ]
          }
        },
        {
          "index": 1,
          "action": "applyStatus",
          "trigger": "skillResolve",
          "target": "blockedEnemies",
          "params": {
            "stun": [
              2,
              2.5,
              3,
              3.5
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_416_zumama/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "highHpAtkScale": [
            1.08,
            1.1,
            1.15,
            1.2
          ],
          "lowHpProtect": [
            0.1,
            0.15,
            0.2,
            0.25
          ],
          "hpRatio": 0.5
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_416_zumama/talents/1",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "spPerSec": [
            0.15,
            0.18,
            0.2,
            0.25
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "spGain",
        "trigger": "blockingTick",
        "target": "self",
        "params": {
          "spPerSec": [
            0.15,
            0.18,
            0.2,
            0.25
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_zumama"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_zumama"
      },
      {
        "unlockStar": 3,
        "index": 2,
        "moduleId": "uniequip_004_zumama"
      }
    ]
  },
  "char_4039_horn": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "ammo",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "rounds": [
              10,
              10,
              10,
              10
            ],
            "atkScale": [
              1.9,
              2.1,
              2.4,
              2.6
            ],
            "magicAtkScale": [
              0.4,
              0.45,
              0.6,
              0.7
            ],
            "overload": [
              1,
              1,
              1,
              1
            ],
            "overloadAt": 0.5
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4039_horn/talents/0",
        "mode": "retain",
        "target": "allDefenders",
        "parameters": {
          "atk": [
            0.1,
            0.14,
            0.2,
            0.24
          ]
        },
        "binding": "assaultTalent:native_talent_0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4039_horn/talents/1",
        "mode": "rewrite",
        "target": "self",
        "parameters": {
          "maxHp": -0.5,
          "attackSpeed": [
            12,
            15,
            18,
            22
          ],
          "def": [
            0.12,
            0.15,
            0.18,
            0.22
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "nativeMechanism",
        "trigger": "deathOncePerDeployment",
        "target": "self",
        "params": {
          "mechanism": "血战再起",
          "heal": [
            1,
            1,
            1,
            1
          ],
          "maxHp": [
            -0.5,
            -0.5,
            -0.5,
            -0.5
          ],
          "attackSpeed": [
            12,
            15,
            18,
            22
          ],
          "def": [
            0.12,
            0.15,
            0.18,
            0.22
          ],
          "emptyAmmoRefill": [
            0,
            0,
            0,
            10
          ],
          "emptyAmmoRefillMaxPerBattle": 1
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_horn"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_horn"
      }
    ]
  },
  "char_1034_jesca2": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "ammo",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "rounds": [
              20,
              20,
              20,
              20
            ],
            "atk": [
              2.7,
              2.9,
              3.1,
              3.2
            ],
            "def": [
              0.65,
              0.7,
              0.8,
              0.85
            ]
          }
        },
        {
          "index": 1,
          "action": "damage",
          "trigger": "skillWhileShieldAlive",
          "target": "frontAreaEnemies",
          "params": {
            "atkScale": [
              2.5,
              2.5,
              2.5,
              2.5
            ],
            "stun": [
              5,
              5,
              6,
              6
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_1034_jesca2/talents/0",
        "mode": "retain",
        "target": "selfAndBehindAllies",
        "parameters": {
          "duration": [
            20,
            35,
            50,
            55
          ],
          "def": [
            0.05,
            0.1,
            0.15,
            0.18
          ],
          "maxShields": 1
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_1034_jesca2/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "prob": [
            0.4,
            0.45,
            0.5,
            0.55
          ],
          "spGain": 1
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "summon",
        "trigger": "deployed",
        "target": "adjacentTiles",
        "params": {
          "deviceId": "jesca2_mobile_shield",
          "count": [
            1,
            1,
            1,
            1
          ],
          "duration": [
            20,
            35,
            50,
            55
          ],
          "def": [
            0.05,
            0.1,
            0.15,
            0.18
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_jesca2"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_jesca2"
      }
    ]
  },
  "char_4194_rmixer": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "ammo",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "rounds": [
              45,
              50,
              50,
              55
            ],
            "atk": [
              1.05,
              1.2,
              1.5,
              1.6
            ],
            "def": [
              0.9,
              1,
              1.3,
              1.4
            ]
          }
        },
        {
          "index": 1,
          "action": "nativeMechanism",
          "trigger": "lethalWhileAmmo",
          "target": "self",
          "params": {
            "mechanism": "弹药抵挡",
            "consume": [
              20,
              20,
              20,
              20
            ],
            "ammoRequired": [
              20,
              20,
              20,
              20
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_4194_rmixer/talents/0",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "def": [
            20,
            25,
            30,
            35
          ],
          "attackSpeed": [
            2,
            2.5,
            3,
            3.5
          ],
          "maxStacks": 3,
          "duration": 10
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_4194_rmixer/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "interval": [
            9,
            8,
            8,
            7
          ],
          "barrier": [
            0.1,
            0.12,
            0.15,
            0.18
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "damageDealt",
        "target": "self",
        "params": {
          "def": [
            20,
            25,
            30,
            35
          ],
          "attackSpeed": [
            2,
            2.5,
            3,
            3.5
          ],
          "maxStacks": [
            3,
            3,
            3,
            3
          ],
          "duration": [
            10,
            10,
            10,
            10
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_rmixer"
      },
      {
        "unlockStar": 3,
        "index": 1,
        "moduleId": "uniequip_003_rmixer"
      }
    ]
  },
  "char_2026_yu": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "damage",
          "trigger": "skillResolve",
          "target": "adjacentEnemies",
          "params": {
            "atkScale": [
              1,
              1.5,
              2.2,
              2.9
            ]
          }
        },
        {
          "index": 1,
          "action": "move",
          "trigger": "skillResolve",
          "target": "adjacentGroundEnemies",
          "params": {
            "teleport": [
              1,
              1,
              1,
              1
            ],
            "maxTargets": [
              3,
              4,
              5,
              6
            ]
          }
        },
        {
          "index": 2,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "blockCnt": [
              2,
              2,
              2,
              2
            ],
            "maxHp": [
              1.3,
              1.4,
              1.6,
              1.7
            ],
            "atk": [
              2,
              2.3,
              2.9,
              3.3
            ],
            "duration": [
              20,
              20,
              20,
              20
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_2026_yu/talents/0",
        "mode": "retain",
        "target": "selfAndBlockedEnemies",
        "parameters": {
          "protect": [
            0.15,
            0.2,
            0.25,
            0.28
          ],
          "magicPerSec": [
            0.25,
            0.3,
            0.4,
            0.45
          ],
          "burnRatio": [
            0.08,
            0.1,
            0.12,
            0.14
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      },
      {
        "sourcePointer": "/char_2026_yu/talents/1",
        "mode": "retain",
        "target": "self",
        "parameters": {
          "minOps": 4,
          "hpPerSec": [
            0.01,
            0.012,
            0.015,
            0.018
          ],
          "epPerSec": [
            0.01,
            0.012,
            0.015,
            0.018
          ]
        },
        "binding": "assaultTalent:native_talent_1",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "nativeMechanism",
        "trigger": "blockingTick",
        "target": "blockedEnemiesAndSelf",
        "params": {
          "mechanism": "礼尚往来",
          "protect": [
            0.15,
            0.2,
            0.25,
            0.28
          ],
          "magicPerSec": [
            0.25,
            0.3,
            0.4,
            0.45
          ],
          "burnRatio": [
            0.08,
            0.1,
            0.12,
            0.14
          ],
          "interval": 1
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_yu"
      }
    ]
  },
  "char_220_grani": {
    "skill": {
      "trigger": "spFull",
      "effects": [
        {
          "index": 0,
          "action": "addBuff",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "atk": [
              0.6,
              0.65,
              0.8,
              0.9
            ],
            "def": [
              0.6,
              0.65,
              0.8,
              0.9
            ],
            "blockCnt": [
              1,
              1,
              1,
              1
            ],
            "duration": [
              30,
              30,
              30,
              30
            ]
          }
        },
        {
          "index": 1,
          "action": "modifyTag",
          "trigger": "skillResolve",
          "target": "self",
          "params": {
            "attackAllBlocked": [
              1,
              1,
              1,
              1
            ],
            "duration": [
              30,
              30,
              30,
              30
            ]
          }
        }
      ]
    },
    "talents": [
      {
        "sourcePointer": "/char_220_grani/talents/0",
        "mode": "retain",
        "target": "allPioneerAllies",
        "parameters": {
          "physDodge": [
            0.1,
            0.14,
            0.2,
            0.24
          ]
        },
        "binding": "modePassive:0",
        "implementation": "pending-card-specific-talent-handler",
        "effects": []
      }
    ],
    "passives": [
      {
        "index": 0,
        "action": "addBuff",
        "trigger": "deployedAura",
        "target": "allAlliesPioneer",
        "params": {
          "physDodge": [
            0.1,
            0.14,
            0.2,
            0.24
          ]
        }
      }
    ],
    "modules": [
      {
        "unlockStar": 3,
        "index": 0,
        "moduleId": "uniequip_002_grani"
      }
    ]
  }
};
