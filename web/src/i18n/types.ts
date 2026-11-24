import type { messages } from './locales/en'

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> }

export type Messages = Widen<typeof messages>

export interface LocaleMeta {
  /** BCP 47 tag, also used for Intl date/number formatting. */
  code: string
  /** Native language name shown in the language menu. */
  name: string
  /** Browser language prefixes that should pick this locale. */
  match: string[]
}

export interface LocaleModule {
  meta: LocaleMeta
  /** Fully translated locales use Messages; new ones may be partial. */
  messages: Messages | DeepPartial<Messages>
}

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T & string]

export type MessageKey = Paths<Messages>
