import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { lists } from "./lists";
import { users } from "./users";

// Impeesa: custom fields per board, like ClickUp's. For now every field is a
// dropdown: a name plus coloured options (e.g. Diseño: Pendiente / Haciendo /
// Listo). A card with no stored value has the field empty.
export const boardFields = pgTable(
  "board_field",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    // An optional field (e.g. Modificaciones) only shows in the card's
    // progress bar once it has a value.
    isOptional: boolean("isOptional").notNull().default(false),
    index: integer("index").notNull().default(0),
    boardId: bigint("boardId", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [index("board_field_board_idx").on(table.boardId)],
).enableRLS();

export const boardFieldOptions = pgTable(
  "board_field_option",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    colourCode: varchar("colourCode", { length: 12 }),
    // Choosing this option counts the field as finished in the card's
    // progress (e.g. Listo, Aprobado).
    isDone: boolean("isDone").notNull().default(false),
    index: integer("index").notNull().default(0),
    fieldId: bigint("fieldId", { mode: "number" })
      .notNull()
      .references(() => boardFields.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [index("board_field_option_field_idx").on(table.fieldId)],
).enableRLS();

export const cardFieldValues = pgTable(
  "card_field_value",
  {
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    fieldId: bigint("fieldId", { mode: "number" })
      .notNull()
      .references(() => boardFields.id, { onDelete: "cascade" }),
    optionId: bigint("optionId", { mode: "number" })
      .notNull()
      .references(() => boardFieldOptions.id, { onDelete: "cascade" }),
    updatedBy: uuid("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.fieldId] })],
).enableRLS();

// Impeesa: "when <field> changes to <option>, <action>". The action is
// either moving the card to <list> (listId) or setting another field of the
// card to an option (setFieldId + setOptionId); exactly one of them is set.
export const boardAutomations = pgTable(
  "board_automation",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    boardId: bigint("boardId", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    fieldId: bigint("fieldId", { mode: "number" })
      .notNull()
      .references(() => boardFields.id, { onDelete: "cascade" }),
    optionId: bigint("optionId", { mode: "number" })
      .notNull()
      .references(() => boardFieldOptions.id, { onDelete: "cascade" }),
    listId: bigint("listId", { mode: "number" }).references(() => lists.id, {
      onDelete: "cascade",
    }),
    setFieldId: bigint("setFieldId", { mode: "number" }).references(
      () => boardFields.id,
      { onDelete: "cascade" },
    ),
    setOptionId: bigint("setOptionId", { mode: "number" }).references(
      () => boardFieldOptions.id,
      { onDelete: "cascade" },
    ),
    isActive: boolean("isActive").notNull().default(true),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [index("board_automation_board_idx").on(table.boardId)],
).enableRLS();

export const boardFieldsRelations = relations(boardFields, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardFields.boardId],
    references: [boards.id],
  }),
  options: many(boardFieldOptions),
}));

export const boardFieldOptionsRelations = relations(
  boardFieldOptions,
  ({ one }) => ({
    field: one(boardFields, {
      fields: [boardFieldOptions.fieldId],
      references: [boardFields.id],
    }),
  }),
);

export const cardFieldValuesRelations = relations(
  cardFieldValues,
  ({ one }) => ({
    card: one(cards, {
      fields: [cardFieldValues.cardId],
      references: [cards.id],
    }),
    field: one(boardFields, {
      fields: [cardFieldValues.fieldId],
      references: [boardFields.id],
    }),
    option: one(boardFieldOptions, {
      fields: [cardFieldValues.optionId],
      references: [boardFieldOptions.id],
    }),
  }),
);

export const boardAutomationsRelations = relations(
  boardAutomations,
  ({ one }) => ({
    field: one(boardFields, {
      fields: [boardAutomations.fieldId],
      references: [boardFields.id],
      relationName: "automationTriggerField",
    }),
    option: one(boardFieldOptions, {
      fields: [boardAutomations.optionId],
      references: [boardFieldOptions.id],
      relationName: "automationTriggerOption",
    }),
    list: one(lists, {
      fields: [boardAutomations.listId],
      references: [lists.id],
    }),
    setField: one(boardFields, {
      fields: [boardAutomations.setFieldId],
      references: [boardFields.id],
      relationName: "automationSetField",
    }),
    setOption: one(boardFieldOptions, {
      fields: [boardAutomations.setOptionId],
      references: [boardFieldOptions.id],
      relationName: "automationSetOption",
    }),
  }),
);
