import { validateEditorDocumentState } from "../../build/editor/model/editor-document-validation"
import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import { inventoryPreviewFingerprint } from "../model/inventory-preview"

import calledArtworkUrl from "./assets/called-by-the-grave-artwork.webp"
import calledPreviewUrl from "./assets/called-by-the-grave-preview.webp"
import dingirsuArtworkUrl from "./assets/dingirsu-the-orcust-of-the-evening-star-artwork.webp"
import dingirsuPreviewUrl from "./assets/dingirsu-the-orcust-of-the-evening-star-preview.webp"
import dinowrestlerArtworkUrl from "./assets/dinowrestler-pankratops-artwork.webp"
import dinowrestlerPreviewUrl from "./assets/dinowrestler-pankratops-preview.webp"
import firewallArtworkUrl from "./assets/firewall-dragon-artwork.webp"
import firewallPreviewUrl from "./assets/firewall-dragon-preview.webp"
import impermanenceArtworkUrl from "./assets/infinite-impermanence-artwork.webp"
import impermanencePreviewUrl from "./assets/infinite-impermanence-preview.webp"
import oddEyesArtworkUrl from "./assets/odd-eyes-arc-pendulum-dragon-artwork.webp"
import oddEyesPreviewUrl from "./assets/odd-eyes-arc-pendulum-dragon-preview.webp"
import salamangreatArtworkUrl from "./assets/salamangreat-violet-chimera-artwork.webp"
import salamangreatPreviewUrl from "./assets/salamangreat-violet-chimera-preview.webp"
import whiteAuraArtworkUrl from "./assets/white-aura-monoceros-artwork.webp"
import whiteAuraPreviewUrl from "./assets/white-aura-monoceros-preview.webp"

import type { InventorySeedSnapshot } from "../persistence/inventory-storage"
import type { CardData } from "yugilife-core"

interface SeedDefinition {
  artworkUrl: string
  card: CardData
  id: string
  previewUrl: string
  title: string
}

const seedDefinitions: readonly SeedDefinition[] = [
  {
    artworkUrl: oddEyesArtworkUrl,
    id: "a620a7b7-956c-46ee-91ba-4593b35b4651",
    previewUrl: oddEyesPreviewUrl,
    title: "Odd-Eyes Arc Pendulum Dragon",
    card: {
      name: "Odd-Eyes Arc Pendulum Dragon",
      cardVariant: "normal",
      attribute: "DARK",
      types: ["Dragon", "Pendulum", "Normal"],
      description: [
        "Made from miracles, this valiant and beautiful dragon has gleaming eyes that reflect an arc drawn in the sky.",
      ],
      attack: "2700",
      cardCode: "LAVD-ENO11",
      serialNumber: "14105623",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      defense: "2000",
      level: 7,
      pendulum: true,
      pendulumSize: "large",
      scales: [8, 8],
      pendulumEffect:
        'If an "Odd-Eyes" card(s) you control is destroyed by battle or card effect: You can Special Summon 1 "Odd-Eyes" monster from your hand, Deck, or GY. You can only use this effect of "Odd-Eyes Arc Pendulum Dragon" once per turn.',
    },
  },
  {
    artworkUrl: dinowrestlerArtworkUrl,
    id: "87a87ed5-09c9-4b0d-8035-e1f6a360e578",
    previewUrl: dinowrestlerPreviewUrl,
    title: "Dinowrestler Pankratops",
    card: {
      name: "Dinowrestler Pankratops",
      cardVariant: "effect",
      attribute: "EARTH",
      types: ["Dinosaur", "Effect"],
      description: [
        'If your opponent controls more monsters than you do, you can Special Summon this card (from your hand). You can only Special Summon "Dinowrestler Pankratops" once per turn this way. (Quick Effect): You can Tribute 1 "Dinowrestler" monster, then target 1 card your opponent controls; destroy it. You can only use this effect of "Dinowrestler Pankratops" once per turn.',
      ],
      attack: "2600",
      cardCode: "SOFU-EN009",
      serialNumber: "82385847",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      defense: "0",
      level: 7,
      pendulum: false,
    },
  },
  {
    artworkUrl: salamangreatArtworkUrl,
    id: "742a9f17-b090-4337-9ae4-0d74f9697b65",
    previewUrl: salamangreatPreviewUrl,
    title: "Salamangreat Violet Chimera",
    card: {
      name: "Salamangreat Violet Chimera",
      cardVariant: "fusion",
      attribute: "FIRE",
      types: ["Cyberse", "Fusion", "Effect"],
      description: [
        '1 "Salamangreat" monster + 1 Link Monster\nIf this card is Fusion Summoned: You can make this card gain ATK equal to half the combined original ATK of the materials used to Summon it, until the end of this turn. Once per battle, during damage calculation, if this monster battles a monster whose current ATK is different from its original ATK (Quick Effect): You can double this card\'s ATK during damage calculation only. If this card that was Fusion Summoned using "Salamangreat Violet Chimera" as material battles a monster, that monster\'s ATK becomes 0 during damage calculation only.',
      ],
      attack: "2800",
      cardCode: "SAST-EN034",
      serialNumber: "37261776",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      defense: "2000",
      level: 8,
      pendulum: false,
    },
  },
  {
    artworkUrl: whiteAuraArtworkUrl,
    id: "0a5d80d5-e570-4680-a646-b55ee30929be",
    previewUrl: whiteAuraPreviewUrl,
    title: "White Aura Monoceros",
    card: {
      name: "White Aura Monoceros",
      cardVariant: "synchro",
      attribute: "WATER",
      types: ["Fish", "Synchro", "Effect"],
      description: [
        '1 WATER Tuner + 1+ non-Tuner monsters\nWhen this card is Synchro Summoned: You can target 1 Fish monster in your GY; Special Summon it, but it cannot attack this turn. You can only use this effect of "White Aura Monoceros" once per turn. If this card you control is destroyed by your opponent\'s card and sent to your GY: You can banish 1 other WATER monster from your GY; Special Summon this card, and if you do, it is treated as a Tuner.',
      ],
      attack: "2500",
      cardCode: "RIRA-EN095",
      serialNumber: "63731062",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      defense: "1500",
      level: 7,
      pendulum: false,
    },
  },
  {
    artworkUrl: dingirsuArtworkUrl,
    id: "7c067e26-f15f-4505-9b61-9c14745d09fc",
    previewUrl: dingirsuPreviewUrl,
    title: "Dingirsu, the Orcust of the Evening Star",
    card: {
      name: "Dingirsu, the Orcust of the Evening Star",
      cardVariant: "xyz",
      attribute: "DARK",
      types: ["Machine", "Xyz", "Effect"],
      description: [
        '2 Level 8 monsters\nYou can only Special Summon "Dingirsu, the Orcust of the Evening Star(s)" once per turn. You can also Xyz Summon this card by using an "Orcust" Link Monster you control as material. If a card(s) you control would be destroyed by battle or card effect, you can detach 1 material from this card instead. If this card is Special Summoned: You can activate 1 of these effects;\n● Send 1 card your opponent controls to the GY.\n● Attach 1 of your banished Machine monsters to this card as material.',
      ],
      attack: "2600",
      cardCode: "DANE-EN038",
      serialNumber: "93854893",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      defense: "2100",
      rank: 8,
      pendulum: false,
    },
  },
  {
    artworkUrl: firewallArtworkUrl,
    id: "a289656d-b3a5-4f89-95cf-f953b606ac65",
    previewUrl: firewallPreviewUrl,
    title: "Firewall Dragon",
    card: {
      name: "Firewall Dragon",
      cardVariant: "link",
      attribute: "LIGHT",
      types: ["Cyberse", "Link", "Effect"],
      description: [
        '2+ monsters\nOnce while face-up on the field (Quick Effect): You can target monsters on the field and/or GY up to the number of monsters co-linked to this card; return them to the hand. If a monster this card points to is destroyed by battle or sent to the GY: You can Special Summon 1 Cyberse monster from your hand. You can only use each effect of "Firewall Dragon" once per turn.',
      ],
      attack: "2500",
      cardCode: "COTD-EN043",
      serialNumber: "5043010",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      link: 0,
      linkArrows: ["top-center", "left-center", "right-center", "bottom-center"],
      pendulum: false,
    },
  },
  {
    artworkUrl: calledArtworkUrl,
    id: "f9e562a2-cef1-47fd-aaff-10b4919b1f3c",
    previewUrl: calledPreviewUrl,
    title: "Called by the Grave",
    card: {
      name: "Called by the Grave",
      cardVariant: "spell",
      description: [
        "Target 1 monster in your opponent's GY; banish it, and if you do, until the end of the next turn, its effects are negated, as well as the activated effects and effects on the field of monsters with the same original name.",
      ],
      cardCode: "FLOD-EN065",
      serialNumber: "24224830",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      spellTrapType: "quick-play",
    },
  },
  {
    artworkUrl: impermanenceArtworkUrl,
    id: "3548f6a2-18e4-49b4-872b-da5dc89257dd",
    previewUrl: impermanencePreviewUrl,
    title: "Infinite Impermanence",
    card: {
      name: "Infinite Impermanence",
      cardVariant: "trap",
      description: [
        "Target 1 face-up monster your opponent controls; negate its effects (until the end of this turn), then, if this card was Set before activation and is on the field at resolution, for the rest of this turn all other Spell/Trap effects in this column are negated. If you control no cards, you can activate this card from your hand.",
      ],
      cardCode: "FLOD-EN077",
      serialNumber: "10045474",
      edition: "1<sup>st</sup> Edition",
      copyright: "©1996 KAZUKI TAKAHASHI",
      spellTrapType: "normal",
    },
  },
]

async function fetchAsset(url: string, label: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load the starter ${label}.`)
  return response.blob()
}

export async function createInventorySeed(): Promise<readonly InventorySeedSnapshot[]> {
  const createdAt = Date.now()
  return Promise.all(
    seedDefinitions.map(async (definition, index) => {
      const [artwork, previewImage] = await Promise.all([
        fetchAsset(definition.artworkUrl, `artwork for “${definition.title}”`),
        fetchAsset(definition.previewUrl, `preview for “${definition.title}”`),
      ])
      const initial = createInitialEditorDocument()
      const document = validateEditorDocumentState({
        ...initial,
        card: { ...initial.card, ...definition.card, artwork },
      })
      const timestamp = createdAt - index
      return {
        card: {
          createdAt: timestamp,
          document,
          id: definition.id,
          revision: 1,
          title: definition.title,
          updatedAt: timestamp,
        },
        preview: {
          cardId: definition.id,
          cardRevision: 1,
          image: previewImage,
          renderFingerprint: inventoryPreviewFingerprint(
            document.templateId,
            document.templateVersion,
          ),
        },
      }
    }),
  )
}
