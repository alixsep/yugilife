import { memo, useState } from "react"

import {
  Bell,
  Clock,
  Globe,
  Lock,
  Mail,
  Monitor,
  Palette,
  Settings,
  Shield,
  SquareLibrary,
  Star,
  Users,
} from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionGroup,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group"
import { CodeBlock } from "@/components/ui/code-block"
import { ColorPicker, ColorPickerPopover } from "@/components/ui/color-picker"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { ImageDropzone } from "@/components/ui/file-upload"
import { Input, Textarea } from "@/components/ui/input"
import { MenuItem } from "@/components/ui/menu-item"
import { NumberInput } from "@/components/ui/number-input"
import { PreviewPlayground } from "@/components/ui/preview-playground"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle"
import { Tooltip } from "@/components/ui/tooltip"

function ControlledColorPickerDemo() {
  const [color, setColor] = useState("#6B97FF")

  return (
    <>
      <ColorPicker value={color} onValueChange={setColor} />
      <p>Current: {color}</p>
    </>
  )
}

function RemovableColorPickerDemo() {
  const [color, setColor] = useState<string | null>("#6B97FF")

  return color ? (
    <ColorPickerPopover
      triggerLabel="Fill"
      triggerShowRemove
      onTriggerRemove={() => setColor(null)}
      value={color}
      onValueChange={setColor}
    />
  ) : (
    <Button variant="ghost" onClick={() => setColor("#6B97FF")}>
      + Add fill
    </Button>
  )
}

const ColorPickerExamples = memo(function ColorPickerExamples() {
  return (
    <>
      <ColorPickerPopover triggerLabel="Fill" defaultValue="#6B97FF" />
      <ControlledColorPickerDemo />
      <RemovableColorPickerDemo />
    </>
  )
})

const monsterTypeOptions = [
  { value: "dragon", label: "Dragon", keywords: ["wyrm"] },
  { value: "warrior", label: "Warrior", keywords: ["soldier"] },
  { value: "spellcaster", label: "Spellcaster", keywords: ["caster", "magic"] },
  { value: "machine", label: "Machine", keywords: ["mechanical"] },
  { value: "fiend", label: "Fiend", keywords: ["demon"] },
]

const checkboxItems = ["Apples", "Bananas", "Cherries", "Dates"]
const dropdownItems = [
  { icon: SquareLibrary, label: "Teamspaces" },
  { icon: Clock, label: "Recents" },
  { icon: Star, label: "Favorites" },
  { icon: Users, label: "Shared" },
  { icon: Lock, label: "Private" },
]
const ampereRatings = [0.1, 0.5, 0.7, 1.1, 1.3]
const qualityLabels = ["Off", "Low", "Medium", "High", "Ultra"]
const textTabs = ["Teamspaces", "Recents", "Favorites", "Shared"]
const iconTabs = [
  { icon: SquareLibrary, label: "Teamspaces" },
  { icon: Clock, label: "Recents" },
  { icon: Star, label: "Favorites" },
  { icon: Users, label: "Shared" },
]

function SwitchExample() {
  const [checked, setChecked] = useState(false)

  return (
    <Switch
      label="Notifications"
      checked={checked}
      onToggle={() => setChecked((previous) => !previous)}
    />
  )
}

function CheckboxExamples() {
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set([0]))

  return (
    <CheckboxGroup checkedIndices={checkedIndices}>
      {checkboxItems.map((label, index) => (
        <CheckboxItem
          key={label}
          index={index}
          label={label}
          checked={checkedIndices.has(index)}
          onToggle={() => {
            setCheckedIndices((previous) => {
              const next = new Set(previous)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
          }}
        />
      ))}
    </CheckboxGroup>
  )
}

function DropdownExamples() {
  const [inlineSelected, setInlineSelected] = useState<number | null>(0)
  const [popupView, setPopupView] = useState(0)

  return (
    <>
      <Dropdown {...(inlineSelected === null ? {} : { checkedIndex: inlineSelected })}>
        {dropdownItems.map((item, index) => (
          <MenuItem
            key={item.label}
            index={index}
            icon={item.icon}
            label={item.label}
            checked={inlineSelected === index}
            onSelect={() => setInlineSelected((current) => (current === index ? null : index))}
          />
        ))}
      </Dropdown>

      <Dropdown>
        <DropdownLabel>Account</DropdownLabel>
        <MenuItem index={0} icon={Mail} label="Email" />
        <MenuItem index={1} icon={Bell} label="Notifications" />
        <MenuItem index={2} icon={Shield} label="Privacy" />
        <DropdownSeparator />
        <DropdownLabel>Appearance</DropdownLabel>
        <MenuItem index={3} icon={Settings} label="General" />
        <MenuItem index={4} icon={Palette} label="Theme" />
        <MenuItem index={5} icon={Monitor} label="Display" />
      </Dropdown>

      <DropdownMenu>
        <DropdownTrigger render={<Button variant="secondary">Open menu</Button>} />
        <DropdownContent checkedIndex={popupView}>
          {dropdownItems.map((item, index) => (
            <MenuItem
              key={item.label}
              index={index}
              icon={item.icon}
              label={item.label}
              checked={popupView === index}
              onSelect={() => setPopupView(index)}
            />
          ))}
        </DropdownContent>
      </DropdownMenu>
    </>
  )
}

function EditorControlsShowcase() {
  const [cardName, setCardName] = useState("")
  const [effectText, setEffectText] = useState(
    "Add the card's effect text here. Rich text support can be layered on later.",
  )
  const [level, setLevel] = useState<number | null>(4)
  const [monsterType, setMonsterType] = useState<string | null>("dragon")
  const [artwork, setArtwork] = useState<Blob | null>(null)

  return (
    <section className="grid gap-4" aria-labelledby="editor-controls-heading">
      <h2 className="text-lg font-medium" id="editor-controls-heading">
        Editor controls
      </h2>

      <Field invalid={cardName.length > 36}>
        <FieldLabel>Card name</FieldLabel>
        <Input
          required
          maxLength={40}
          placeholder="Blue-Eyes White Dragon"
          value={cardName}
          onChange={(event) => setCardName(event.target.value)}
        />
        <FieldDescription>{cardName.length} / 40 characters</FieldDescription>
        {cardName.length > 36 && <FieldError>Keep the card name under 40 characters.</FieldError>}
      </Field>

      <Field>
        <FieldLabel>Effect text</FieldLabel>
        <Textarea
          maxLength={200}
          value={effectText}
          onChange={(event) => setEffectText(event.target.value)}
        />
        <FieldDescription>{effectText.length} / 200 characters</FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Level</FieldLabel>
        <NumberInput value={level} min={0} max={12} step={1} onValueChange={setLevel} />
        <FieldDescription>Use the stepper buttons or arrow keys.</FieldDescription>
      </Field>

      <Field invalid={monsterType === null}>
        <FieldLabel>Monster type</FieldLabel>
        <Combobox
          items={monsterTypeOptions}
          value={monsterType}
          placeholder="Search monster types…"
          inputProps={{ required: true }}
          onValueChange={setMonsterType}
        />
        <FieldDescription>Search by name or keyword, such as “caster”.</FieldDescription>
        {monsterType === null && <FieldError>Choose a monster type.</FieldError>}
      </Field>

      <Field>
        <FieldLabel>Artwork</FieldLabel>
        <ImageDropzone
          value={artwork}
          accept="image/*"
          maxSize={5 * 1024 * 1024}
          onValueChange={setArtwork}
        />
        <FieldDescription>
          PNG, JPEG, or another browser-supported image up to 5 MB.
        </FieldDescription>
      </Field>
    </section>
  )
}

function LinkedSliderExamples() {
  const [value, setValue] = useState(25)

  return (
    <>
      <Slider size="compact" value={value} onChange={setValue} />
      <Slider value={value} onChange={setValue} valuePosition="left" label="Volume" />
      <Slider value={value} onChange={setValue} valuePosition="right" label="Volume" />
      <Slider value={value} onChange={setValue} valuePosition="tooltip" />
      <Slider
        size="compact"
        value={value}
        onChange={setValue}
        formatValue={(next) => `${next}%`}
        label="Opacity"
      />
    </>
  )
}

function RangeSliderExample() {
  const [value, setValue] = useState<[number, number]>([25, 75])
  return <Slider value={value} onChange={setValue} />
}

function SteppedSliderExample({ step }: { step: number }) {
  const [value, setValue] = useState(50)
  return <Slider value={value} onChange={setValue} step={step} showSteps />
}

function AmpereSliderExample() {
  const [value, setValue] = useState(0.7)

  return (
    <Slider
      value={value}
      onChange={setValue}
      steps={ampereRatings}
      showSteps
      label="Rating"
      formatValue={(next) => `${next} A`}
    />
  )
}

function RatingSliderExample() {
  const [value, setValue] = useState(5)
  return <Slider label="Rating" value={value} onChange={setValue} min={0} max={5} />
}

function VolumeSliderExample() {
  const [value, setValue] = useState(50)

  return (
    <Slider
      variant="scrubber"
      label="Volume"
      value={value}
      onChange={setValue}
      min={0}
      max={100}
      formatValue={(next) => `${next}%`}
    />
  )
}

function QualitySliderExample() {
  const [value, setValue] = useState(2)

  return (
    <Slider
      label="Quality"
      value={value}
      onChange={setValue}
      min={0}
      max={4}
      formatValue={(next) => qualityLabels[next] ?? String(next)}
    />
  )
}

function SliderExamples() {
  return (
    <>
      <LinkedSliderExamples />
      <RangeSliderExample />
      <SteppedSliderExample step={25} />
      <SteppedSliderExample step={10} />
      <AmpereSliderExample />
      <Slider size="compact" value={50} onChange={() => {}} disabled />
      <RatingSliderExample />
      <VolumeSliderExample />
      <QualitySliderExample />
      <Slider label="Roundness" value={2} onChange={() => {}} min={0} max={4} disabled />
    </>
  )
}

function SelectExamples() {
  const [fruit, setFruit] = useState("")
  const [timezone, setTimezone] = useState("")
  const [role, setRole] = useState("")

  return (
    <>
      <Select value={fruit} onValueChange={setFruit}>
        <SelectTrigger placeholder="Select a fruit…" />
        <SelectContent>
          <SelectItem index={0} value="apple">
            Apple
          </SelectItem>
          <SelectItem index={1} value="banana">
            Banana
          </SelectItem>
          <SelectItem index={2} value="cherry">
            Cherry
          </SelectItem>
          <SelectItem index={3} value="mango">
            Mango
          </SelectItem>
        </SelectContent>
      </Select>
      <Select value={timezone} onValueChange={setTimezone}>
        <SelectTrigger icon={Globe} placeholder="Select timezone…" />
        <SelectContent>
          <SelectItem index={0} value="utc-8">
            (UTC-8) Pacific Time
          </SelectItem>
          <SelectItem index={1} value="utc-7">
            (UTC-7) Mountain Time
          </SelectItem>
          <SelectItem index={2} value="utc-6">
            (UTC-6) Central Time
          </SelectItem>
          <SelectItem index={3} value="utc-5">
            (UTC-5) Eastern Time
          </SelectItem>
          <SelectItem index={4} value="utc-4">
            (UTC-4) Atlantic Time
          </SelectItem>
          <SelectItem index={5} value="utc-3">
            (UTC-3) Buenos Aires
          </SelectItem>
          <SelectItem index={6} value="utc-1">
            (UTC-1) Azores
          </SelectItem>
          <SelectItem index={7} value="utc+0">
            (UTC+0) London
          </SelectItem>
          <SelectItem index={8} value="utc+1">
            (UTC+1) Paris
          </SelectItem>
          <SelectItem index={9} value="utc+2">
            (UTC+2) Helsinki
          </SelectItem>
          <SelectItem index={10} value="utc+3">
            (UTC+3) Moscow
          </SelectItem>
          <SelectItem index={11} value="utc+5:30">
            (UTC+5:30) Mumbai
          </SelectItem>
          <SelectItem index={12} value="utc+8">
            (UTC+8) Singapore
          </SelectItem>
          <SelectItem index={13} value="utc+9">
            (UTC+9) Tokyo
          </SelectItem>
          <SelectItem index={14} value="utc+10">
            (UTC+10) Sydney
          </SelectItem>
          <SelectItem index={15} value="utc+12">
            (UTC+12) Auckland
          </SelectItem>
        </SelectContent>
      </Select>
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger placeholder="Select a role…" error="Please select a role to continue." />
        <SelectContent>
          <SelectItem index={0} value="admin">
            Admin
          </SelectItem>
          <SelectItem index={1} value="editor">
            Editor
          </SelectItem>
          <SelectItem index={2} value="viewer">
            Viewer
          </SelectItem>
        </SelectContent>
      </Select>
      <Select disabled>
        <SelectTrigger placeholder="Disabled" />
        <SelectContent>
          <SelectItem index={0} value="a">
            Option A
          </SelectItem>
        </SelectContent>
      </Select>
      <Select>
        <SelectTrigger placeholder="Some disabled…" />
        <SelectContent>
          <SelectItem index={0} value="a">
            Available
          </SelectItem>
          <SelectItem index={1} value="b" disabled>
            Unavailable
          </SelectItem>
          <SelectItem index={2} value="c">
            Available
          </SelectItem>
        </SelectContent>
      </Select>
    </>
  )
}

function TextTabsExample() {
  const [selected, setSelected] = useState(0)

  return (
    <>
      <TabsSubtle idPrefix="demo" selectedIndex={selected} onSelect={setSelected}>
        {textTabs.map((label, index) => (
          <TabsSubtleItem key={label} index={index} label={label} />
        ))}
      </TabsSubtle>
      {textTabs.map((label, index) => (
        <TabsSubtlePanel key={label} index={index} selectedIndex={selected} idPrefix="demo">
          <p>{label} content</p>
        </TabsSubtlePanel>
      ))}
    </>
  )
}

function IconTabsExample() {
  const [selected, setSelected] = useState(0)

  return (
    <>
      <TabsSubtle idPrefix="demo-icons" selectedIndex={selected} onSelect={setSelected}>
        {iconTabs.map((tab, index) => (
          <TabsSubtleItem key={tab.label} index={index} icon={tab.icon} label={tab.label} />
        ))}
      </TabsSubtle>
      {iconTabs.map((tab, index) => (
        <TabsSubtlePanel
          key={tab.label}
          index={index}
          selectedIndex={selected}
          idPrefix="demo-icons"
        >
          <p>{tab.label} content</p>
        </TabsSubtlePanel>
      ))}
    </>
  )
}

function ActiveLabelTabsExample() {
  const [selected, setSelected] = useState(0)

  return (
    <TabsSubtle
      activeLabel
      idPrefix="demo-active-label"
      selectedIndex={selected}
      onSelect={setSelected}
    >
      {iconTabs.map((tab, index) => (
        <TabsSubtleItem key={tab.label} index={index} icon={tab.icon} label={tab.label} />
      ))}
    </TabsSubtle>
  )
}

function TabsExamples() {
  return (
    <>
      <TextTabsExample />
      <IconTabsExample />
      <ActiveLabelTabsExample />
    </>
  )
}

export function UIShowcase() {
  return (
    <>
      {/* Switches */}
      <SwitchExample />
      <CheckboxExamples />

      {/* Dropdowns */}
      <DropdownExamples />

      {/* Accordions */}
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>What is this component?</AccordionTrigger>
          <AccordionContent>
            A collapsible accordion with animated expand/collapse and spring-animated chevron.
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AccordionGroup type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1" index={0}>
          <AccordionTrigger>Getting Started</AccordionTrigger>
          <AccordionContent>
            Install the component and import it into your project. The accordion supports both
            single and multiple expand modes.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2" index={1}>
          <AccordionTrigger>Styling</AccordionTrigger>
          <AccordionContent>
            The component integrates with the shape system for pill or rounded border-radius
            variants. All animations use spring physics.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3" index={2}>
          <AccordionTrigger>Accessibility</AccordionTrigger>
          <AccordionContent>
            Built on Radix UI or Base UI Accordion (your pick) with WAI-ARIA attributes, keyboard
            navigation, and focus management.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-4" index={3}>
          <AccordionTrigger>Animation</AccordionTrigger>
          <AccordionContent>
            Smooth height transitions and spring-animated chevron rotation. The proximity hover
            background tracks your cursor.
          </AccordionContent>
        </AccordionItem>
      </AccordionGroup>

      <AccordionGroup type="multiple" defaultValue={["item-1", "item-3"]}>
        <AccordionItem value="item-1" index={0}>
          <AccordionTrigger>First Section</AccordionTrigger>
          <AccordionContent>Multiple items can be expanded at the same time.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2" index={1}>
          <AccordionTrigger>Second Section</AccordionTrigger>
          <AccordionContent>
            Click any trigger to expand or collapse independently.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3" index={2}>
          <AccordionTrigger>Third Section</AccordionTrigger>
          <AccordionContent>Each item operates independently in multiple mode.</AccordionContent>
        </AccordionItem>
      </AccordionGroup>

      {/* Dialog */}
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="tertiary">Open dialog</Button>
        </DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Create teamspace</DialogTitle>
            <DialogDescription>Add a new teamspace to organize your projects.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tooltips */}
      <Tooltip content="Save your changes">
        <Button variant="tertiary">Hover me</Button>
      </Tooltip>

      <div className="flex flex-wrap gap-2">
        <Tooltip content="Top" side="top">
          <Button variant="ghost">Top</Button>
        </Tooltip>
        <Tooltip content="Right" side="right">
          <Button variant="ghost">Right</Button>
        </Tooltip>
        <Tooltip content="Bottom" side="bottom">
          <Button variant="ghost">Bottom</Button>
        </Tooltip>
        <Tooltip content="Left" side="left">
          <Button variant="ghost">Left</Button>
        </Tooltip>
      </div>

      <Tooltip
        content={
          <div className="flex flex-col gap-1">
            <span className="font-medium">Keyboard shortcut</span>
            <span className="text-muted-foreground">⌘ + S</span>
          </div>
        }
      >
        <Button variant="secondary">Save</Button>
      </Tooltip>

      <div className="flex gap-2">
        <Tooltip content="Instant" delayDuration={0}>
          <Button variant="ghost">Instant</Button>
        </Tooltip>
        <Tooltip content="Slow" delayDuration={500}>
          <Button variant="ghost">Slow</Button>
        </Tooltip>
      </div>

      {/* Color pickers */}
      <ColorPickerExamples />

      {/* Editor control primitives */}
      <EditorControlsShowcase />

      {/* Preview workspace and authored code */}
      <div className="h-80 w-full">
        <PreviewPlayground contentHeight={240} contentWidth={168}>
          <div className="bg-foreground text-background grid size-full place-items-center">
            Preview
          </div>
        </PreviewPlayground>
      </div>
      <CodeBlock code={`1<sup>st</sup> Edition`} />

      {/* Sliders */}
      <SliderExamples />

      {/* Selects */}
      <SelectExamples />

      {/* Tabs */}
      <TabsExamples />
    </>
  )
}
