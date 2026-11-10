import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { HiCheck } from "react-icons/hi2";

import LabelIcon from "~/components/LabelIcon";

export interface BoardFieldOption {
  publicId: string;
  name: string;
  colourCode: string | null;
}

// Impeesa: a field's value on a board card that can be changed right there,
// without opening the card. The menu is drawn outside the card (anchor), so
// the card's rounded border doesn't cut it.
//
// The card is a link and can be dragged, so presses here must not reach it:
// otherwise picking an option would open the card or start a drag.
export default function BoardFieldSelect({
  fieldName,
  options,
  selectedOptionPublicId,
  onSelect,
  children,
}: {
  fieldName: string;
  options: BoardFieldOption[];
  selectedOptionPublicId: string | null;
  // null empties the field (picking the current option again).
  onSelect: (optionPublicId: string | null) => void;
  children: React.ReactNode;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span
      className="flex"
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Menu>
        <MenuButton
          aria-label={`Cambiar ${fieldName}`}
          className="-mx-1 flex items-center rounded px-1 hover:bg-light-200 focus:outline-none dark:hover:bg-dark-400"
        >
          {children}
        </MenuButton>
        <MenuItems
          anchor="bottom end"
          className="z-50 mt-1 max-h-64 min-w-[160px] overflow-y-auto rounded-md border border-light-200 bg-light-50 p-1 text-xs shadow-lg [--anchor-gap:4px] focus:outline-none dark:border-dark-500 dark:bg-dark-200"
        >
          <p className="px-2 pb-1 pt-0.5 text-[11px] text-light-800 dark:text-dark-800">
            {fieldName}
          </p>
          {options.map((option) => {
            const isSelected = option.publicId === selectedOptionPublicId;
            return (
              <MenuItem key={option.publicId}>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : option.publicId)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-light-1000 data-[focus]:bg-light-200 dark:text-dark-1000 dark:data-[focus]:bg-dark-300"
                >
                  <LabelIcon colourCode={option.colourCode} />
                  <span className="flex-1">{option.name}</span>
                  {isSelected && <HiCheck className="h-3.5 w-3.5" />}
                </button>
              </MenuItem>
            );
          })}
        </MenuItems>
      </Menu>
    </span>
  );
}
