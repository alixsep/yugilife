/**
 * Where a donation starts. Yugilife's maker cannot take card payments where they live, so the
 * sheet asks people to get in touch first; the invoice follows in the conversation.
 *
 * `handle` is what the copy button puts on the clipboard. `href` is what the row opens and what
 * its QR code encodes, and is optional: Discord has no public URL for a username — only the
 * numeric user ID works in `discord.com/users/…` — so that row is text you copy rather than a
 * link that would 404, and its code carries the username itself.
 */
export interface DonateContact {
  readonly id: "telegram" | "discord" | "email"
  readonly label: string
  readonly handle: string
  readonly href?: string
}

export const donateContacts: readonly DonateContact[] = [
  {
    id: "telegram",
    label: "Telegram",
    handle: "@alixsep",
    href: "https://t.me/alixsep",
  },
  {
    id: "discord",
    label: "Discord",
    handle: "alixsepofficial",
  },
  {
    id: "email",
    label: "Email",
    handle: "alixsep@outlook.com",
    href: "mailto:alixsep@outlook.com",
  },
]

/**
 * The title asks plainly; the line under it gives the reason. The three kinds of help are marked
 * in the sheet itself rather than spelled out here, because the marking is what makes them
 * findable at a glance.
 */
export const donateCopy = {
  title: "I need your support",
  situation: "I’m living in Iran, and there’s a war.",
  /** Why a stranger might feel they have already been given something, and what happens next. */
  note: "Yugilife is free and always will be. For donations, message me and I’ll send a Bitcoin Lightning invoice.",
} as const
