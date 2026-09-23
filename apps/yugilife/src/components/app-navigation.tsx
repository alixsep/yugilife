import { Archive, BookOpen, Hammer } from "lucide-react"
import { Link, NavLink } from "react-router"

import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { DonateButton } from "./donate/donate-button"
import { Button } from "./ui/button"
import { Tooltip } from "./ui/tooltip"
import { AppearanceMenu } from "./appearance-menu"
import { LogoMark } from "./logo-mark"

import type { MouseEvent, SVGProps } from "react"

interface AppNavigationProps {
  onBeforeNavigate?: (() => boolean) | undefined
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 192 192"
      aria-hidden="true"
      className={`fill-none stroke-current ${props.className ?? ""}`}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="12"
        d="M120.755 170c.03-4.669.059-20.874.059-27.29 0-9.272-3.167-15.339-6.719-18.41 22.051-2.464 45.201-10.863 45.201-49.067 0-10.855-3.824-19.735-10.175-26.683 1.017-2.516 4.413-12.63-.987-26.32 0 0-8.296-2.672-27.202 10.204-7.912-2.213-16.371-3.308-24.784-3.352-8.414.044-16.872 1.14-24.785 3.352C52.457 19.558 44.162 22.23 44.162 22.23c-5.4 13.69-2.004 23.804-.987 26.32C36.824 55.498 33 64.378 33 75.233c0 38.204 23.149 46.603 45.2 49.067-3.551 3.071-6.719 9.138-6.719 18.41 0 6.416.03 22.621.059 27.29M27 130c9.939.703 15.67 9.735 15.67 9.735 8.834 15.199 23.178 10.803 28.815 8.265"
      />
    </svg>
  )
}

export function AppNavigation({ onBeforeNavigate }: AppNavigationProps = {}) {
  const sizeClasses = useSize()
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      `text-muted-foreground hover:text-(--user-accent) flex ${sizeClasses.control} aspect-square items-center justify-center transition-colors lg:aspect-auto lg:w-auto lg:gap-1 lg:px-2`,
      isActive && "text-foreground",
    )
  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onBeforeNavigate && !onBeforeNavigate()) event.preventDefault()
  }

  return (
    <header className="relative mx-auto flex h-12 w-full max-w-[1920px] shrink-0 items-center justify-between px-3 sm:px-5">
      <Link
        to="/"
        className={`text-foreground flex items-center ${sizeClasses.gap}`}
        aria-label="Yugilife home"
        onClick={guardNavigation}
      >
        <LogoMark className="size-5" />
        <span className={`${sizeClasses.body} hidden font-medium tracking-[0.22em] md:inline`}>
          YUGILIFE
        </span>
      </Link>

      <nav
        className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1"
        aria-label="Primary navigation"
      >
        <NavLink
          to="/inventory"
          aria-label="Inventory"
          className={navClass}
          onClick={guardNavigation}
        >
          <Archive size={sizeClasses.icon} strokeWidth={1.5} />
          <span className={`${sizeClasses.caption} hidden lg:inline`}>Inventory</span>
        </NavLink>
        <NavLink to="/build" aria-label="Build" className={navClass} onClick={guardNavigation}>
          <Hammer size={sizeClasses.icon} strokeWidth={1.5} />
          <span className={`${sizeClasses.caption} hidden lg:inline`}>Build</span>
        </NavLink>
        <NavLink to="/blog" aria-label="Blog" className={navClass} onClick={guardNavigation}>
          <BookOpen size={sizeClasses.icon} strokeWidth={1.5} />
          <span className={`${sizeClasses.caption} hidden lg:inline`}>Blog</span>
        </NavLink>
      </nav>

      <div className="-mr-2.5 flex items-center gap-1">
        <DonateButton />
        <AppearanceMenu />
        <Tooltip content="GitHub" side="bottom" sideOffset={10}>
          <Button asChild variant="text" size="icon" aria-label="Open Yugilife on GitHub">
            <a href="https://github.com/alixsep/yugilife" target="_blank" rel="noreferrer">
              <GithubIcon />
            </a>
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
