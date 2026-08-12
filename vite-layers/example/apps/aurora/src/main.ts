// Aurora has no bootstrap logic of its own — `#super` re-resolves this file's own path
// (main.ts) from the next-lower layer, i.e. main/src/main.ts.
import '#super'
