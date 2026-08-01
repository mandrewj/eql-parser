// Plane of Sky class quests — generated from https://eqlwiki.com/Plane_of_Sky
// by scripts/build-sky-quests.mjs on 2026-08-01. Do not edit by hand.
//
// 16 classes, 95 quests, 127 required-item slots. The reward and item
// names are the wiki's verbatim; matching them against what the game writes is `sky.ts`'s job,
// because the two disagree on apostrophes and capitalisation.

import type { ClassCode } from "./spells.js";

export interface SkyQuestItem {
  name: string;
  /** Which island it drops on, spelled out; null when the wiki tags no island. */
  island: string | null;
  /** The mob the page-wide loot table names, when it lists one. */
  dropsFrom: string | null;
}

export interface SkyQuest {
  quest: string;
  /** What you say to the quest giver to be handed the rune. */
  trigger: string;
  /** The Wind Rune the giver hands over — a turn-in component, but obtained by asking
   *  rather than looted, so holding one means the quest is started rather than progressed. */
  rune: string;
  items: SkyQuestItem[];
  /** Usually one; Beastlord's Test of Claw awards a weapon in each hand. */
  rewards: string[];
}

export interface SkyClass {
  className: string;
  code: ClassCode;
  giver: string;
  quests: SkyQuest[];
}

export const SKY_CLASSES: readonly SkyClass[] = [
  {
    "className": "Bard",
    "code": "BRD",
    "giver": "Cilin Spellsinger",
    "quests": [
      {
        "quest": "Bard Test of Tone",
        "trigger": "tone",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Light Woolen Mask",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Mask of Song"
        ]
      },
      {
        "quest": "Bard Test of Voice",
        "trigger": "voice",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Light Woolen Mantle",
            "island": "Island 4 — Pegasus",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Mantle of the Songweaver"
        ]
      },
      {
        "quest": "Bard Test of Pitch",
        "trigger": "pitch",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Crude Wooden Flute",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Ervaj's Flute of Flight"
        ]
      },
      {
        "quest": "Bard Test of Wind",
        "trigger": "wind",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Amulet of Woven Hair",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Fae Amulet"
        ]
      },
      {
        "quest": "Bard Test of Brass",
        "trigger": "brass",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Glowing Diamond",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Efreeti War Horn",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air, The Hand of Veeshan"
          }
        ],
        "rewards": [
          "Denon's Horn of Disaster"
        ]
      },
      {
        "quest": "Bard Test of Harmony",
        "trigger": "harmony",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Nebulous Diamond",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti War Spear",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Harmonic Spear"
        ]
      }
    ]
  },
  {
    "className": "Beastlord",
    "code": "BST",
    "giver": "Animist Kratho",
    "quests": [
      {
        "quest": "Beastlord Test of Aviak",
        "trigger": "aviak",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Spiroc Elder's Totem",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Spiroc Beak Earcuff"
        ]
      },
      {
        "quest": "Beastlord Test of Azarack",
        "trigger": "azarack",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Azarack Skin",
            "island": "Island 2 — Azarack",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Azarack Skin Wristwraps"
        ]
      },
      {
        "quest": "Beastlord Test of Claw",
        "trigger": "claw",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Sphinx Claw",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Mithril Bands",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Brass Knuckles",
            "island": null,
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Windhowl",
          "Spirit Render"
        ]
      },
      {
        "quest": "Beastlord Test of Harpy",
        "trigger": "harpy",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Leather Cord",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Griffin-Hide Armguards"
        ]
      },
      {
        "quest": "Beastlord Test of Wind",
        "trigger": "wind",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "Silken Wrap",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Diaphonous Waistband"
        ]
      }
    ]
  },
  {
    "className": "Berserker",
    "code": "BER",
    "giver": "Stragen The Hewer",
    "quests": [
      {
        "quest": "Berserker Test of Sharpness",
        "trigger": "sharpness",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Djinni War Blade",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Efreeti Standard",
            "island": null,
            "dropsFrom": "Noble Dojorn"
          }
        ],
        "rewards": [
          "Skycleaver"
        ]
      },
      {
        "quest": "Berserker Test of Will",
        "trigger": "will",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Pulsating Ruby",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Molten Coil"
        ]
      },
      {
        "quest": "Berserker Test of Ferocity",
        "trigger": "ferocity",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "High Quality Raiment",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Sash of Ferocity"
        ]
      },
      {
        "quest": "Berserker Test of Burden",
        "trigger": "burden",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Feathered Cape",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Shroud of the Sky"
        ]
      },
      {
        "quest": "Berserker Test of Blood",
        "trigger": "blood",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Azarack Blood",
            "island": "Island 2 — Azarack",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Blood-Drawn Runes"
        ]
      },
      {
        "quest": "Berserker Test of Fools Errand",
        "trigger": "fools errand",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Jester's Mask",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          },
          {
            "name": "Efreeti Great Staff",
            "island": null,
            "dropsFrom": "Eye of Veeshan, Noble Dojorn"
          }
        ],
        "rewards": [
          "Cudgel of the Fool"
        ]
      }
    ]
  },
  {
    "className": "Cleric",
    "code": "CLR",
    "giver": "Josin Faithbringer",
    "quests": [
      {
        "quest": "Cleric Test of Courage",
        "trigger": "courage",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Silver Hoop",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Truewind Earring"
        ]
      },
      {
        "quest": "Cleric Test of Skill",
        "trigger": "skill",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Small Shield",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Aegis of the Wind"
        ]
      },
      {
        "quest": "Cleric Test of Protection",
        "trigger": "protection",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Shiny Pauldrons",
            "island": "Island 5 — Spiroc",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Pauldrons of Piety"
        ]
      },
      {
        "quest": "Cleric Test of Resolution",
        "trigger": "resolution",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Silvered Spiroc Necklace",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Necklace of Resolution"
        ]
      },
      {
        "quest": "Cleric Test of Theurgy",
        "trigger": "theurgy",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Djinni Aura",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Efreeti Mace",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Theurgist's Star"
        ]
      },
      {
        "quest": "Cleric Test of The Weak",
        "trigger": "weak",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Mithril Bands",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti Standard",
            "island": null,
            "dropsFrom": "Noble Dojorn"
          }
        ],
        "rewards": [
          "Baton of the Sky"
        ]
      }
    ]
  },
  {
    "className": "Druid",
    "code": "DRU",
    "giver": "Strandar Pinemist",
    "quests": [
      {
        "quest": "Druid Test of Wolf",
        "trigger": "wolf",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Worn Leather Mask",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Drake-Hide Mask"
        ]
      },
      {
        "quest": "Druid Test of Bear",
        "trigger": "bear",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Mantle of Woven Grass",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Nature Walker's Mantle"
        ]
      },
      {
        "quest": "Druid Test of Tree",
        "trigger": "tree",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Spiroc Battle Staff",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          },
          {
            "name": "Efreeti Statuette",
            "island": null,
            "dropsFrom": "an essence harvester, an essence tamer"
          }
        ],
        "rewards": [
          "Shillelagh"
        ]
      },
      {
        "quest": "Druid Test of The Bee",
        "trigger": "bee",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Divine Honeycomb",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Honeycomb Belt"
        ]
      },
      {
        "quest": "Druid Test of Eagle",
        "trigger": "eagle",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Ethereal Ruby",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Spiroc Elder's Totem",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Spiroc Banisher Focus"
        ]
      },
      {
        "quest": "Druid Test of Nature",
        "trigger": "nature",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Storm Sky Opal",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti Scimitar",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Espri"
        ]
      }
    ]
  },
  {
    "className": "Enchanter",
    "code": "ENC",
    "giver": "Enchanter Jolas",
    "quests": [
      {
        "quest": "Enchanter Test of Illusion",
        "trigger": "illusion",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Finely Woven Cloth Cord",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Sphinx Hair Cord"
        ]
      },
      {
        "quest": "Enchanter Test of Metamorphism",
        "trigger": "metamorphism",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "Light Cloth Mantle",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Wind Walker's Mantle"
        ]
      },
      {
        "quest": "Enchanter Test of Deception",
        "trigger": "deception",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Silken Mask",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Ivory Mask"
        ]
      },
      {
        "quest": "Enchanter Test of Disillusion",
        "trigger": "disillusion",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Adamantium Earring",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Earring of Displacement"
        ]
      },
      {
        "quest": "Enchanter Test of Memorization",
        "trigger": "memorization",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Glowing Necklace",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Necklace of Whispering Winds"
        ]
      },
      {
        "quest": "Enchanter Test of Incapacitation",
        "trigger": "incapacitation",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Large Sky Sapphire",
            "island": "Island 8 — Veeshan",
            "dropsFrom": null
          },
          {
            "name": "Efreeti Wind Staff",
            "island": null,
            "dropsFrom": "Noble Dojorn, The Hand of Veeshan"
          }
        ],
        "rewards": [
          "Rod of the Protecting Winds"
        ]
      }
    ]
  },
  {
    "className": "Magician",
    "code": "MAG",
    "giver": "Magus Frinon",
    "quests": [
      {
        "quest": "Magician Test of Clarification",
        "trigger": "clarification",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Feathered Cape",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Bracelet of Clarification"
        ]
      },
      {
        "quest": "Magician Test of Empowerment",
        "trigger": "empowerment",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Ceramic Mask",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Mask of Empowerment"
        ]
      },
      {
        "quest": "Magician Test of Shielding",
        "trigger": "shielding",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Golden Coffer",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Gold White Pendant"
        ]
      },
      {
        "quest": "Magician Test of Summoning",
        "trigger": "summoning",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Large Diamond",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Drake-Hide Amice"
        ]
      },
      {
        "quest": "Magician Test of Interpretation",
        "trigger": "interpretation",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Golden Efreeti Ring",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Duennan Shielding Ring"
        ]
      },
      {
        "quest": "Magician Test of Gesticulation",
        "trigger": "gesticulation",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Hazy Opal",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti Magi Staff",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Staff of The Magister"
        ]
      },
      {
        "quest": "Magician Test of Displacement",
        "trigger": "displacement",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Crown Of Elemental Mastery",
            "island": "Island 7 — trash",
            "dropsFrom": null
          },
          {
            "name": "Large Opal",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Djinni Stave",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Staff of Elemental Mastery: Air"
        ]
      }
    ]
  },
  {
    "className": "Monk",
    "code": "MNK",
    "giver": "Holwin",
    "quests": [
      {
        "quest": "Monk Test of Strength",
        "trigger": "strength",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Silken Strands",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Back Straps of Mastery"
        ]
      },
      {
        "quest": "Monk Test of Sight",
        "trigger": "sight",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "Cracked Leather Eyepatch",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Ton Po's Eye Patch"
        ]
      },
      {
        "quest": "Monk Test of Speed",
        "trigger": "speed",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Dove Slippers",
            "island": "Island 5 — Spiroc",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Sandals of Alacrity"
        ]
      },
      {
        "quest": "Monk Test of Tears",
        "trigger": "tears",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Silken Wrap",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Ton Po's Shoulder Wraps"
        ]
      },
      {
        "quest": "Monk Test of Fists",
        "trigger": "fists",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Nebulous Sapphire",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Brass Knuckles",
            "island": null,
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Wu's Fist of Mastery"
        ]
      },
      {
        "quest": "Monk Test of Tranquility",
        "trigger": "tranquility",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Tear of Quellious",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          }
        ],
        "rewards": [
          "Golden Sash of Tranquility"
        ]
      }
    ]
  },
  {
    "className": "Necromancer",
    "code": "NEC",
    "giver": "Drakis Bloodcaster",
    "quests": [
      {
        "quest": "Necromancer Test of Flight",
        "trigger": "flight",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Griffon's Beak",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Bloody Griffon-Hide Wrist Guard"
        ]
      },
      {
        "quest": "Necromancer Test of Power",
        "trigger": "power",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Black Silk Cape",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Cloak of Spiroc Feathers"
        ]
      },
      {
        "quest": "Necromancer Test of Mind",
        "trigger": "mind",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "Fine Cloth Raiment",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Bloodsoaked Raiment"
        ]
      },
      {
        "quest": "Necromancer Test of Heart",
        "trigger": "heart",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Pulsating Ruby",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Sphinx Heart Amulet"
        ]
      },
      {
        "quest": "Necromancer Test of Finger",
        "trigger": "finger",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Ring of Veeshan",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Band of Wailing Winds"
        ]
      },
      {
        "quest": "Necromancer Test of Hands",
        "trigger": "hands",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Gorgon Head",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          },
          {
            "name": "Efreeti Great Staff",
            "island": null,
            "dropsFrom": "Eye of Veeshan, Noble Dojorn"
          }
        ],
        "rewards": [
          "Gorgon Head Staff"
        ]
      }
    ]
  },
  {
    "className": "Paladin",
    "code": "PAL",
    "giver": "Dason Goldblade",
    "quests": [
      {
        "quest": "Paladin Test of Spirit",
        "trigger": "spirit",
        "rune": "Wind Rune Lena",
        "items": [
          {
            "name": "Ivory Sky Diamond",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Girdle of Faith"
        ]
      },
      {
        "quest": "Paladin Test of Sacrifice",
        "trigger": "sacrifice",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "Bixie Sword Blade",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          }
        ],
        "rewards": [
          "Aldryn, Blade of the Ocean"
        ]
      },
      {
        "quest": "Paladin Test of Love",
        "trigger": "love",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "Golden Hilt",
            "island": "Island 7 — Drake",
            "dropsFrom": "a greater sphinx, a heartsbane drake, an undine spirit"
          },
          {
            "name": "Sphinx Claw",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Thelvorn, Blade of Light"
        ]
      },
      {
        "quest": "Paladin Test of Compassion",
        "trigger": "compassion",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Large Sky Diamond",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti Zweihander",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Truvinan"
        ]
      }
    ]
  },
  {
    "className": "Ranger",
    "code": "RNG",
    "giver": "Ranger Spirit",
    "quests": [
      {
        "quest": "Ranger Test of Body",
        "trigger": "body",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Griffon Talon",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Griffon Talon Necklace"
        ]
      },
      {
        "quest": "Ranger Test of Defense",
        "trigger": "defense",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Fine Velvet Cloak",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Dark Cloak of the Sky"
        ]
      },
      {
        "quest": "Ranger Test of The Earth",
        "trigger": "elemental earth",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Spiroc Earth Totem",
            "island": "Island 5 — Spiroc",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Earthshaker's Mantle"
        ]
      },
      {
        "quest": "Ranger Test of Thunder",
        "trigger": "elemental thunder",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "White Gold Earring",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt (Island 6 Boss)"
          }
        ],
        "rewards": [
          "Thunderforged Earring"
        ]
      },
      {
        "quest": "Ranger Test of Blade",
        "trigger": "blade",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Circlet of Brambles",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Efreeti Long Sword",
            "island": null,
            "dropsFrom": "Noble Dojorn"
          }
        ],
        "rewards": [
          "Arydryidriyorn"
        ]
      },
      {
        "quest": "Ranger Test of Ranged Attack",
        "trigger": "ranged attack",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Shimmering Pearl",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti War Bow",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air, The Hand of Veeshan"
          }
        ],
        "rewards": [
          "Windstriker"
        ]
      }
    ]
  },
  {
    "className": "Rogue",
    "code": "ROG",
    "giver": "Thalik Silenthand",
    "quests": [
      {
        "quest": "Rogue Test of Thievery",
        "trigger": "thievery",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "Inlaid Choker",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Wispy Choker of Vigor"
        ]
      },
      {
        "quest": "Rogue Test of Trickery",
        "trigger": "trickery",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Sphinxian Circlet",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Renard's Belt of Quickness"
        ]
      },
      {
        "quest": "Rogue Test of Silence",
        "trigger": "silence",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Spiroc Sky Totem",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Griffon Wing Spauldors"
        ]
      },
      {
        "quest": "Rogue Test of Cunning",
        "trigger": "cunning",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Jester's Mask",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Crystal Mask"
        ]
      },
      {
        "quest": "Rogue Test of Stealth",
        "trigger": "stealth",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "Fine Wool Cloak",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Scintillating Bracer of Protection"
        ]
      },
      {
        "quest": "Rogue Test of Deception",
        "trigger": "deception",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Bixie Stinger",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          },
          {
            "name": "Bloodsky Sapphire",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          }
        ],
        "rewards": [
          "Thornstinger"
        ]
      }
    ]
  },
  {
    "className": "Shadow Knight",
    "code": "SHD",
    "giver": "Sarkis Ebonblade",
    "quests": [
      {
        "quest": "Shadow Knight Test of Bash",
        "trigger": "bash",
        "rune": "Wind Rune Ozah",
        "items": [
          {
            "name": "Finely Crafted Amulet",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Amulet of the Sphinx Eye"
        ]
      },
      {
        "quest": "Shadow Knight Test of Smash",
        "trigger": "smash",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Silvery Ring",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Crimson Ring of the Djinni"
        ]
      },
      {
        "quest": "Shadow Knight Test of Slash",
        "trigger": "slash",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Finely Woven Cloth Belt",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Pegasus-Hide Belt"
        ]
      },
      {
        "quest": "Shadow Knight Test of Disempowerment",
        "trigger": "disempowerment",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Rusted Pauldrons",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Blood Sky Face Plate"
        ]
      },
      {
        "quest": "Shadow Knight Test of Envenoming",
        "trigger": "envenoming",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Efreeti War Shield",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Obtenebrate Mithril Guard"
        ]
      },
      {
        "quest": "Shadow Knight Raising of the Dead",
        "trigger": "raising of the dead",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Sphinxian Ring",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Fae Pauldrons",
            "island": "Island 8 — Veeshan",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Pearlescent Pauldrons"
        ]
      },
      {
        "quest": "Shadow Knight Test of Necropotence",
        "trigger": "necropotence",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Blood Sky Ruby",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti War Axe",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Khyldorn the Blood Drinker"
        ]
      }
    ]
  },
  {
    "className": "Shaman",
    "code": "SHM",
    "giver": "Medicine Man Veetra",
    "quests": [
      {
        "quest": "Shaman Test of Might",
        "trigger": "might",
        "rune": "Wind Rune Meda",
        "items": [
          {
            "name": "Leather Cord",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Amulet of the Fang"
        ]
      },
      {
        "quest": "Shaman Test of Health",
        "trigger": "health",
        "rune": "Wind Rune Kala",
        "items": [
          {
            "name": "Ceremonial Belt",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Bracelet of the Spirits"
        ]
      },
      {
        "quest": "Shaman Test of Sight",
        "trigger": "sight",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Light Damask Mantle",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Fairy-Hide Mantle"
        ]
      },
      {
        "quest": "Shaman Test of Shrink",
        "trigger": "shrink",
        "rune": "Wind Rune Ena",
        "items": [
          {
            "name": "Corrosive Venom",
            "island": "Island 6 — Bee",
            "dropsFrom": null
          },
          {
            "name": "Efreeti War Club",
            "island": null,
            "dropsFrom": "Noble Dojorn"
          }
        ],
        "rewards": [
          "Warhammer of the Wind"
        ]
      },
      {
        "quest": "Shaman Test of Snake",
        "trigger": "snake",
        "rune": "Wind Rune Heda",
        "items": [
          {
            "name": "Bixie Essence",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzzazzt, Bizazzzt, Bzzzt"
          },
          {
            "name": "Spiritualist`s Ring",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Vermilion Sky Ring"
        ]
      },
      {
        "quest": "Shaman Test of The Witch Doctor",
        "trigger": "witch doctor",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "Symbol of Veeshan",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti War Maul",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Garduk"
        ]
      }
    ]
  },
  {
    "className": "Warrior",
    "code": "WAR",
    "giver": "Torgon Blademaster",
    "quests": [
      {
        "quest": "Warrior Test of Skill",
        "trigger": "skill",
        "rune": "Wind Rune Neza",
        "items": [
          {
            "name": "Azure Ring",
            "island": "Island 3 — Harpy",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Azure Ruby Ring"
        ]
      },
      {
        "quest": "Warrior Test of Strength",
        "trigger": "strength",
        "rune": "Wind Rune Azia",
        "items": [
          {
            "name": "Stone Amulet",
            "island": "Island 4 — Pegasus",
            "dropsFrom": "Keeper of Souls"
          }
        ],
        "rewards": [
          "Runed Wind Amulet"
        ]
      },
      {
        "quest": "Warrior Test of Force",
        "trigger": "force",
        "rune": "Wind Rune Beza",
        "items": [
          {
            "name": "Spiroc Air Totem",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Pauldrons of the Blue Sky"
        ]
      },
      {
        "quest": "Warrior Test of Think",
        "trigger": "think",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Wind Tablet",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          },
          {
            "name": "Efreeti Belt",
            "island": null,
            "dropsFrom": "Noble Dojorn, The Hand of Veeshan"
          }
        ],
        "rewards": [
          "Belt of the Four Winds"
        ]
      },
      {
        "quest": "Warrior Test of Smash",
        "trigger": "smash",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Djinni War Blade",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          },
          {
            "name": "Gem of Invigoration",
            "island": "Island 7 — trash",
            "dropsFrom": "Protector of Sky"
          }
        ],
        "rewards": [
          "Dagas"
        ]
      },
      {
        "quest": "Warrior Test of Bash",
        "trigger": "bash",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Ethereal Emerald",
            "island": "Island 8 — Veeshan",
            "dropsFrom": "Eye of Veeshan"
          },
          {
            "name": "Efreeti Battle Axe",
            "island": null,
            "dropsFrom": "Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Fangol"
        ]
      }
    ]
  },
  {
    "className": "Wizard",
    "code": "WIZ",
    "giver": "Wizard Schrock",
    "quests": [
      {
        "quest": "Wizard Test of Concentration",
        "trigger": "concentration",
        "rune": "Wind Rune Dena",
        "items": [
          {
            "name": "Grey Damask Cloak",
            "island": "Island 3 — Harpy",
            "dropsFrom": "Gorgalosk"
          }
        ],
        "rewards": [
          "Augmentor's Mask"
        ]
      },
      {
        "quest": "Wizard Test of Focus",
        "trigger": "focus",
        "rune": "Wind Rune Fana",
        "items": [
          {
            "name": "Woven Skull Cap",
            "island": "Island 4 — Pegasus",
            "dropsFrom": null
          }
        ],
        "rewards": [
          "Al`Kabor's Cap of Binding"
        ]
      },
      {
        "quest": "Wizard Test of Meditation",
        "trigger": "meditation",
        "rune": "Wind Rune Geza",
        "items": [
          {
            "name": "High Quality Raiment",
            "island": "Island 5 — Spiroc",
            "dropsFrom": "The Spiroc Lord"
          }
        ],
        "rewards": [
          "Raiment of Thunder"
        ]
      },
      {
        "quest": "Wizard Test of Conception",
        "trigger": "conception",
        "rune": "Wind Rune Izah",
        "items": [
          {
            "name": "Box of Winds",
            "island": "Island 6 — Bee",
            "dropsFrom": "Bazzt Zzzt"
          },
          {
            "name": "Efreeti Statuette",
            "island": null,
            "dropsFrom": "an essence harvester, an essence tamer"
          }
        ],
        "rewards": [
          "Solidate Mithril Ring"
        ]
      },
      {
        "quest": "Wizard Test of Visualization",
        "trigger": "visualization",
        "rune": "Wind Rune Jaka",
        "items": [
          {
            "name": "Amethyst Amulet",
            "island": "Island 7 — Drake",
            "dropsFrom": "Sister of the Spire"
          }
        ],
        "rewards": [
          "Amulet of the Void"
        ]
      },
      {
        "quest": "Wizard Test of Preparation",
        "trigger": "preparation",
        "rune": "Wind Rune Caza",
        "items": [
          {
            "name": "Large Sky Lapis",
            "island": "Island 8 — Veeshan",
            "dropsFrom": null
          },
          {
            "name": "Efreeti War Staff",
            "island": null,
            "dropsFrom": "The Hand of Veeshan, Noble Dojorn, Overseer of Air"
          }
        ],
        "rewards": [
          "Nargon's Staff"
        ]
      }
    ]
  }
];
