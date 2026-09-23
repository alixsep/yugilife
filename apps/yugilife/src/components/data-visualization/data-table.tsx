import { cn } from "@/lib/utils"

import { FIGURE_TYPE } from "./chart-tokens"

import type { ReactNode } from "react"

export interface DataTableColumn {
  readonly key: string
  readonly label: string
  /** Numeric columns are right-aligned and use tabular figures so digits line up. */
  readonly numeric?: boolean
}

export interface DataTableProps {
  readonly columns: readonly DataTableColumn[]
  readonly rows: readonly (readonly (string | number)[])[]
  /**
   * Names the table for a screen reader. It is not drawn: the figure this table belongs to already
   * carries the title visually, and printing it twice would only repeat it.
   */
  readonly caption: string
  /** Shown under the table when its rows are a sample of a larger series. */
  readonly note?: ReactNode
  readonly className?: string
}

/**
 * The values behind a figure, as rows.
 *
 * It lives here rather than in the UI kit because it is not a general-purpose table: no sorting,
 * selection, pagination, or column resizing. A real data grid would be a different component with
 * different problems; this one stays small enough that a chart hands it an array and is done.
 */
export function DataTable({ caption, className, columns, note, rows }: DataTableProps) {
  return (
    <div className={cn("pt-3", className)}>
      {/* Capped and scrollable: a long table must never push the rest of the article off the
          screen, and the sticky header keeps the columns named while it scrolls. */}
      <div className="bg-surface-2 max-h-[21rem] overflow-auto rounded-lg">
        <table className={cn(FIGURE_TYPE.table, "w-full border-collapse text-left")}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 sticky top-0 z-10">
            <tr>
              {columns.map((column) => (
                <th
                  className={cn(
                    "border-border text-muted-foreground border-b px-4 pt-3 pb-2 font-medium whitespace-nowrap",
                    column.numeric && "text-right",
                  )}
                  key={column.key}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    className={cn(
                      "text-foreground px-4 py-2 whitespace-nowrap",
                      columns[cellIndex]?.numeric && "text-right tabular-nums",
                    )}
                    key={cellIndex}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note !== undefined && (
        <div className={cn(FIGURE_TYPE.footnote, "text-muted-foreground mt-2.5")}>{note}</div>
      )}
    </div>
  )
}
