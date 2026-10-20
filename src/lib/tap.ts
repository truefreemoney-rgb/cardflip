/**
 * Invisible tap layers (review 10-19 #24): a before: pseudo-element grows a
 * small pill, chip or text link to a >= 44px hit area without changing how it
 * looks (the app header's phone strip did it first). The number is how far
 * the layer reaches above and below, in px: pick the one that lifts the
 * control to 44px and still ends inside the gap to the next control, or a
 * near tap lands on the neighbour. A scroller clips the layer, so a scrolling
 * row needs room inside it (GameToggle's -my-2 py-2).
 */
export const TAP_4 = "relative before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
export const TAP_6 = "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";
export const TAP_8 = "relative before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']";
export const TAP_10 = "relative before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']";
/** A bare text link or word button (16-20px tall): 14px above and below, 6px to each side. */
export const TAP_LINK = "relative before:absolute before:-inset-x-1.5 before:-inset-y-3.5 before:content-['']";
