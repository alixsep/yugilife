import type { SVGProps } from "react"

export const logoPath =
  "M4.3549233,0.26458326 3.3919188,2.9104163 H2.0690021 L2.5505044,1.5874997 H1.2275879 L0.26458333,4.2333329 H2.9104166 L1.9474121,6.8791659 H5.916162 L6.8791665,4.2333329 H5.5562499 L5.0747477,5.5562493 H3.7518311 L5.67784,0.26458326 Z"

type LogoMarkProps = SVGProps<SVGSVGElement> & {
  pathClassName?: string
  pathProps?: SVGProps<SVGPathElement>
}

export function LogoMark({ pathClassName, pathProps, ...props }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 7.14375 7.14375" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path {...pathProps} className={pathClassName} d={logoPath} fill="currentColor" />
    </svg>
  )
}
