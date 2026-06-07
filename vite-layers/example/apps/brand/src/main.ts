// Brand has no bootstrap logic of its own — it reuses the base layer's entry.
// `@/main.ts` resolves to *this* file first, but the layered resolver's self-skip
// (super() semantics) falls through to the next layer, i.e. main/src/main.ts.
import '@/main.ts'
