/**
 * Invite a friend is OFF (Chris, 10-06: "should be removed until we can work it out
 * better"). The page, header pill and account row hide and no bonus is granted;
 * ?ref= is still recorded at signup so nothing is lost when it comes back.
 * Before turning it on: pending reward when the inviter isn't subscribed yet, and
 * take the bonus back on a refunded first payment (docs/BACKLOG.md).
 */
export const REFERRALS_ON = false;
