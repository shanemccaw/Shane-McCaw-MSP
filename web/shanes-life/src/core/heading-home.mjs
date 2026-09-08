// The real "Heading Home?" quick action (Git #3216, Feature #3237): resolves which real house
// Shane is heading toward, then fires the real Tesla commands at it. Sits above places.mjs
// (presence + "which home") and tesla.mjs (the actual vehicle commands) rather than living in
// either -- a real, distinct concern spanning both, same reasoning this app already applies
// elsewhere for a composed action (e.g. recordHookEvent bridging tesla.mjs into nudges.mjs).

import * as places from "./places.mjs";
import * as teslaCore from "./tesla.mjs";
import { badRequest } from "../http.mjs";

/**
 * `house`, if given, is Shane's own explicit override (the widget/Next card's one-tap
 * alternative when the recommended house is wrong) -- otherwise the real, observed
 * places.headingHomeSignal() recommendation is used. Either way the target house must have a
 * real place on file tagged with it (places.house) -- there is no coordinate to navigate to
 * otherwise, and this deliberately never estimates or geocodes one (same real discipline
 * push_place's own tool description already states for places generally).
 */
export async function triggerHeadingHome(userId, { house } = {}) {
  let targetHouse = house || null;
  if (!targetHouse) {
    const signal = await places.headingHomeSignal(userId);
    if (!signal?.recommendedHouse) {
      throw badRequest(
        "No recommended house yet -- Shane hasn't been observed leaving one, and none was named explicitly.",
      );
    }
    targetHouse = signal.recommendedHouse;
  }

  const place = await places.findByHouse(userId, targetHouse);
  if (!place) {
    throw badRequest(`No saved place is tagged as house "${targetHouse}" yet -- tell Claude "this is house ${targetHouse}" first.`);
  }

  const result = await teslaCore.sendHeadingHomeCommands(userId, {
    latitude: place.latitude,
    longitude: place.longitude,
    label: place.label,
  });
  await places.markHeadingHomeTriggered(userId);
  return { ...result, targetHouse, targetLabel: place.label };
}

/** Real data the widget/Next card need to decide whether to show the action at all, and what
 *  to label it -- Tesla connected + a vehicle selected + a real recommended (or already
 *  house-tagged) destination, all at once. */
export async function headingHomeAvailability(userId) {
  const [status, signal] = await Promise.all([teslaCore.connectionStatus(userId), places.headingHomeSignal(userId)]);
  if (!status.connected || !status.vehicleId || !signal?.recommendedHouse) return null;
  const place = await places.findByHouse(userId, signal.recommendedHouse);
  if (!place) return null;
  const houses = await places.listHouses(userId);
  const alternatives = houses.filter((h) => h.house !== signal.recommendedHouse);
  return {
    recommendedHouse: signal.recommendedHouse,
    recommendedLabel: place.label,
    vehicleDisplayName: status.vehicleDisplayName,
    alternatives, // [{ house, id, label }, ...] -- the real one-tap "not this one" option(s)
  };
}
