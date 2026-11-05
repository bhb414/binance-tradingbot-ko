export const botNeedsStop=bot=>Boolean(bot?.runtime?.runEnabled||bot?.runtime?.managementEnabled||bot?.runtime?.closePending||bot?.runtime?.closeAll||bot?.runtime?.stopPending||bot?.runtime?.pendingOrderCount);
export const botStopPending=bot=>Boolean(bot?.runtime?.stopPending);
