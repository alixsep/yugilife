import { Check, Code2, Download, SlidersHorizontal, WandSparkles } from "lucide-react"

import {
  AccordionContent,
  AccordionGroup,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { CodeBlock } from "@/components/ui/code-block"

const steps = [
  {
    icon: WandSparkles,
    title: "Choose a template",
    copy: "Choose the card’s visual foundation. If its assets are not stored yet, load them once.",
  },
  {
    icon: Check,
    title: "Add the card details",
    copy: "Fill in the card itself. Automatic mode chooses the matching presentation as you work.",
  },
  {
    icon: SlidersHorizontal,
    title: "Adjust only when needed",
    copy: "Advanced mode is for deliberate typography, texture, and layer overrides.",
  },
  {
    icon: Download,
    title: "Save or export",
    copy: "Download the rendered card, or keep an editable JSON copy for later.",
  },
]

export function BuildGuide() {
  return (
    <section className="grid gap-5 p-4">
      <div className="grid gap-1">
        <h2 className="text-title font-medium">Build guide</h2>
        <p className="text-body text-muted-foreground">
          Everything you need to make a card—without having to understand the renderer underneath.
        </p>
      </div>

      <ol className="grid gap-2">
        {steps.map(({ copy, icon: Icon, title }, index) => (
          <li className="border-border flex gap-3 border-b py-3 last:border-b-0" key={title}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div className="grid gap-0.5">
              <p className="text-body font-medium">
                {index + 1}. {title}
              </p>
              <p className="text-caption text-muted-foreground">{copy}</p>
            </div>
          </li>
        ))}
      </ol>

      <AccordionGroup className="w-full max-w-none" type="multiple" defaultValue={["rich-text"]}>
        <AccordionItem index={0} value="rich-text">
          <AccordionTrigger>Rich text</AccordionTrigger>
          <AccordionContent>
            <div className="text-body grid gap-4 py-3">
              <p className="text-muted-foreground">
                Rich text is a small card-text language, not HTML. Type the supported tags directly
                in a text field; the exact source stays editable and preview, SVG, and image exports
                all use the same formatting.
              </p>

              <div className="grid gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <Code2 className="size-4" /> Emphasis and color
                </div>
                <CodeBlock
                  code={`<b>Bold text</b>\n<i>Italic text</i>\n<color value="#7a1515">Crimson text</color>`}
                />
              </div>

              <div className="grid gap-2">
                <p className="font-medium">Card notation</p>
                <CodeBlock
                  code={`1<sup>st</sup> Edition\nH<sub>2</sub>O\n<ruby text="カオス">Chaos</ruby>`}
                />
              </div>

              <div className="grid gap-2">
                <p className="font-medium">Scale, spacing, and position</p>
                <CodeBlock
                  code={`<scale x="0.9">Narrower text</scale>\nATK<space width="8px"/>/DEF\n<shift x="2px" y="-1px">Shifted text</shift>`}
                />
              </div>

              <div className="grid gap-2">
                <p className="font-medium">Wrapping and alignment</p>
                <CodeBlock
                  code={`<nowrap>Keep this phrase together</nowrap>\n<align value="center">Centered text</align>\n<nocompress>Keep authored width</nocompress>`}
                />
              </div>

              <div className="border-border grid gap-1 border-t pt-3">
                <p className="font-medium">A few rules</p>
                <ul className="text-muted-foreground grid list-disc gap-1 pl-5">
                  <li>Close paired tags in reverse order when nesting them.</li>
                  <li>Tag names are case-sensitive.</li>
                  <li>
                    The spacing tag is self-closing: <code>{`<space width="8px"/>`}</code>.
                  </li>
                  <li>Lengths accept pixels or em units, such as 8px or 0.5em.</li>
                  <li>
                    Unknown or malformed markup stays visible and produces a warning; the editor
                    does not silently rewrite it.
                  </li>
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem index={1} value="automatic">
          <AccordionTrigger>Automatic and Advanced modes</AccordionTrigger>
          <AccordionContent>
            <div className="text-body text-muted-foreground grid gap-3 py-3">
              <p>
                Automatic mode derives the frame, layers, semantic text, and fitting behavior from
                the current card data and selected template.
              </p>
              <p>
                Advanced mode exposes typography, texture, and layer visibility overrides. Those
                explicit choices remain attached to the card until you reset them. Switching modes
                preserves inactive card fields instead of deleting them.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem index={2} value="projects">
          <AccordionTrigger>JSON projects and templates</AccordionTrigger>
          <AccordionContent>
            <div className="text-body text-muted-foreground grid gap-3 py-3">
              <p>
                An editable JSON download is a self-contained, single-card editor document. It
                includes card fields, presentation choices, template identity, and uploaded card
                images so you can continue later.
              </p>
              <p>
                Comparison references and local comparison settings are not part of that JSON. It is
                also not a multi-card inventory archive.
              </p>
              <p>
                A template bundle is different: it defines the reusable, declarative rendering
                system and its assets. Official templates are immutable; custom templates are
                validated before the app stores or activates them.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem index={3} value="preview">
          <AccordionTrigger>Moving around the preview</AccordionTrigger>
          <AccordionContent>
            <div className="text-body text-muted-foreground grid gap-3 py-3">
              <p>
                Drag the playground to pan and scroll over it to zoom. Space-drag and the arrow keys
                also move the canvas; use plus and minus to zoom from the keyboard.
              </p>
              <p>
                Double-click the playground, press 0, or use the fit control to recenter the card.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </AccordionGroup>
    </section>
  )
}
