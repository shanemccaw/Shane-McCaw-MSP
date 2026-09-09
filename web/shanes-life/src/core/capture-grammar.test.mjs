// Real, node-runnable assertions for the pure half of capture-grammar.mjs -- classification
// (matchRule) and its parsing helpers never touch the database, so they're covered here directly
// with no fixture DB required. The DB-backed execution half (runCaptureGrammar's `run()` calls)
// is exercised live via `npm run check` against the real database, same discipline as the rest
// of this app's own bin/check.mjs.
//
// Run: node src/core/capture-grammar.test.mjs

import assert from "node:assert/strict";
import {
  extractDateTokens,
  extractRecurrenceDays,
  extractTime,
  extractTimerDuration,
  formatDuration,
  matchRule,
  resolveDateTokenToISO,
  resolveNextDayOfMonthISO,
  tieredMatch,
} from "./capture-grammar.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------------------------------------
// Pure date/time/recurrence parsing
// ---------------------------------------------------------------------------------------------

check("extractDateTokens: month day", () => {
  const t = extractDateTokens("dr appointment oct 3rd 2pm dr fonji every 6 weeks");
  assert.deepEqual({ monthIndex: t.monthIndex, day: t.day, year: t.year }, { monthIndex: 9, day: 3, year: null });
});

check("extractDateTokens: month day year", () => {
  const t = extractDateTokens("want to go to the air show nov 7, 2027");
  assert.deepEqual({ monthIndex: t.monthIndex, day: t.day, year: t.year }, { monthIndex: 10, day: 7, year: 2027 });
});

check("extractDateTokens: month + year only (no day) defaults day to 1", () => {
  const t = extractDateTokens("pepper rabies due february 2027");
  assert.equal(t.dayOmitted, true);
  assert.deepEqual({ monthIndex: t.monthIndex, day: t.day, year: t.year }, { monthIndex: 1, day: 1, year: 2027 });
});

check("extractDateTokens: full month name", () => {
  const t = extractDateTokens("ronnie's birthday december 14");
  assert.deepEqual({ monthIndex: t.monthIndex, day: t.day }, { monthIndex: 11, day: 14 });
});

check("extractDateTokens: nothing date-shaped returns null", () => {
  assert.equal(extractDateTokens("add my Kia Forte"), null);
});

check("extractTime: 2pm / 2:30pm", () => {
  assert.equal(extractTime("dr appointment oct 3rd 2pm"), "14:00");
  assert.equal(extractTime("appointment at 9:15am"), "09:15");
  assert.equal(extractTime("no time here"), null);
});

check("extractRecurrenceDays: every N weeks/days/months", () => {
  assert.equal(extractRecurrenceDays("every 6 weeks"), 42);
  assert.equal(extractRecurrenceDays("every 3 days"), 3);
  assert.equal(extractRecurrenceDays("every month"), 30);
  assert.equal(extractRecurrenceDays("no recurrence stated"), null);
});

check("resolveDateTokenToISO: explicit year wins", () => {
  const iso = resolveDateTokenToISO({ monthIndex: 1, day: 1, year: 2027 });
  assert.equal(iso, "2027-02-01");
});

check("resolveDateTokenToISO: no year, date still ahead this year -> stays this year", () => {
  const asOf = new Date(2026, 0, 15); // Jan 15 2026
  const iso = resolveDateTokenToISO({ monthIndex: 11, day: 14, year: null }, asOf); // Dec 14
  assert.equal(iso, "2026-12-14");
});

check("resolveDateTokenToISO: no year, date already passed this year -> rolls to next year", () => {
  const asOf = new Date(2026, 11, 20); // Dec 20 2026
  const iso = resolveDateTokenToISO({ monthIndex: 11, day: 14, year: null }, asOf); // Dec 14
  assert.equal(iso, "2027-12-14");
});

check("resolveNextDayOfMonthISO: day still ahead this month", () => {
  const asOf = new Date(2026, 8, 5); // Sep 5 2026
  assert.equal(resolveNextDayOfMonthISO(12, asOf), "2026-09-12");
});

check("resolveNextDayOfMonthISO: day already passed -> rolls to next month", () => {
  const asOf = new Date(2026, 8, 20); // Sep 20 2026
  assert.equal(resolveNextDayOfMonthISO(12, asOf), "2026-10-12");
});

check("resolveNextDayOfMonthISO: December rolls into next January", () => {
  const asOf = new Date(2026, 11, 20); // Dec 20 2026
  assert.equal(resolveNextDayOfMonthISO(5, asOf), "2027-01-05");
});

// ---------------------------------------------------------------------------------------------
// tieredMatch
// ---------------------------------------------------------------------------------------------

check("tieredMatch: exact beats prefix/substring", () => {
  const candidates = [{ name: "Kia Forte" }, { name: "Kia" }];
  assert.equal(tieredMatch(candidates, "kia").match.name, "Kia");
});

check("tieredMatch: single prefix hit resolves", () => {
  const candidates = [{ name: "Tesla Model 3" }, { name: "Kia Forte" }];
  assert.equal(tieredMatch(candidates, "tesla").match.name, "Tesla Model 3");
});

check("tieredMatch: ambiguous substring is not resolved", () => {
  const candidates = [{ name: "H1 Electric" }, { name: "H2 Electric" }];
  assert.equal(tieredMatch(candidates, "electric").ok, false);
});

check("tieredMatch: nothing found is not resolved", () => {
  assert.equal(tieredMatch([{ name: "Kia" }], "tesla").ok, false);
});

// ---------------------------------------------------------------------------------------------
// matchRule -- classification only (no DB, no execution)
// ---------------------------------------------------------------------------------------------

check("matchRule: person note requires a colon and real name shape", () => {
  assert.equal(matchRule("dana: had a rough day about the lease").rule, "person_note");
  assert.equal(matchRule("no colon here at all"), null);
});

check("matchRule: meds batch", () => {
  assert.equal(matchRule("took my morning meds").rule, "meds_batch_taken");
  assert.equal(matchRule("evening meds done").rule, "meds_batch_taken");
});

check("matchRule: Tesla stop wins over warm when both phrases present", () => {
  assert.equal(matchRule("stop warming up the car").rule, "tesla_stop_preconditioning");
});

check("matchRule: Tesla warm / trunk / heading home / commute / reads", () => {
  assert.equal(matchRule("warm it up").rule, "tesla_warm_preconditioning");
  assert.equal(matchRule("precondition the tesla").rule, "tesla_warm_preconditioning");
  assert.equal(matchRule("open the trunk").rule, "tesla_open_trunk");
  assert.equal(matchRule("heading home").rule, "tesla_heading_home");
  assert.equal(matchRule("take me home").rule, "tesla_heading_home");
  assert.equal(matchRule("commute is 96 miles").rule, "tesla_commute_miles");
  assert.equal(matchRule("commute is 96 miles").groups.miles, 96);
  assert.equal(matchRule("how's the battery").rule, "tesla_charge_status");
  assert.equal(matchRule("what's my car's charge at").rule, "tesla_charge_status");
  assert.equal(matchRule("is the car warming up").rule, "tesla_climate_status");
});

check("matchRule: Tesla home electricity rate (Git #3318)", () => {
  assert.equal(matchRule("home electricity is 14 cents").rule, "tesla_home_electricity_rate");
  assert.equal(matchRule("home electricity is 14 cents").groups.ratePerKwh, 0.14);
  assert.equal(matchRule("home electricity costs 0.145 dollars").groups.ratePerKwh, 0.145);
  assert.equal(matchRule("home electricity is $0.14").groups.ratePerKwh, 0.14);
  assert.equal(matchRule("home electricity is 14 cents a kWh").rule, "tesla_home_electricity_rate");
});

check("matchRule: money what-if / give / put / move / smoke", () => {
  assert.equal(matchRule("what if I spend 60").rule, "money_what_if");
  assert.equal(matchRule("what if I spend 60").groups.amount, 60);
  assert.equal(matchRule("give Rent 300").rule, "money_give_or_put");
  assert.equal(matchRule("put 300 toward Rent").rule, "money_give_or_put");
  assert.equal(matchRule("move 200 from Direct Deposit to Tesla").rule, "money_move_transfer");
  assert.equal(matchRule("smoked").rule, "money_smoke_log");
  assert.equal(matchRule("bought a pack").rule, "money_smoke_log");
});

check("matchRule: wins", () => {
  assert.equal(matchRule("I did it, the mortgage is caught up").rule, "wins_log");
  assert.equal(matchRule("paid off the Chrysler Capital collection").rule, "wins_log");
});

check("matchRule: pet vaccine due", () => {
  const m = matchRule("pepper rabies due february 2027");
  assert.equal(m.rule, "pet_vaccine_due");
  assert.equal(m.groups.petName, "pepper");
  assert.equal(m.groups.vaccineName, "rabies");
});

check("matchRule: birthday / visit / event / appointment / vet", () => {
  assert.equal(matchRule("ronnie's birthday dec 14").rule, "date_birthday");
  assert.equal(matchRule("mom's coming to visit the 12th-18th").rule, "date_visit");
  assert.equal(matchRule("want to go to the air show nov 7").rule, "date_event");
  assert.equal(matchRule("dr appointment oct 3rd 2pm dr fonji every 6 weeks").rule, "date_appointment");
  assert.equal(matchRule("vet appointment nov 2").rule, "date_appointment");
});

check("matchRule: who-fixed-what contact", () => {
  const m = matchRule("plumber is Ray 321-555-0142");
  assert.equal(m.rule, "contact_trade");
  assert.equal(m.groups.trade, "plumber");
  assert.equal(m.groups.name, "Ray");
  assert.equal(m.groups.phone, "321-555-0142");
});

check("matchRule: add a vehicle (make-allowlisted), including the bare 'Add Tesla' example", () => {
  assert.equal(matchRule("add my Kia Forte").rule, "vehicle_add");
  assert.equal(matchRule("Add Tesla").rule, "vehicle_add");
  // Not make-allowlisted -- correctly stays ambiguous, per issue #3292's own explicit non-goal.
  assert.equal(matchRule("add my new couch") == null, true);
});

check("matchRule: vehicle maintenance log", () => {
  const m = matchRule("did an oil change on the Kia, $45");
  assert.equal(m.rule, "vehicle_maintenance_log");
  assert.equal(m.groups.description, "oil change");
  assert.equal(m.groups.vehicle, "Kia");
  assert.equal(m.groups.amount, 45);
});

check("matchRule: medication ordered", () => {
  assert.equal(matchRule("ordered my thyroid refill").rule, "medication_ordered");
});

check("matchRule: watch/read lists", () => {
  assert.equal(matchRule("watch the new Bond movie").rule, "watch_or_read_list");
  assert.equal(matchRule("read Project Hail Mary").rule, "watch_or_read_list");
});

check("matchRule: new list, explicit (Git #3305)", () => {
  const m1 = matchRule("new list: Camping");
  assert.equal(m1.rule, "new_list");
  assert.equal(m1.groups.name, "Camping");
  assert.equal(m1.groups.firstItem, null);

  const m2 = matchRule("new list: Camping: headlamp");
  assert.equal(m2.rule, "new_list");
  assert.equal(m2.groups.name, "Camping");
  assert.equal(m2.groups.firstItem, "headlamp");
});

check("matchRule: named list add, both real phrasings (Git #3305)", () => {
  const m1 = matchRule("gifts list: speaker for DJ");
  assert.equal(m1.rule, "named_list_add");
  assert.equal(m1.groups.rawName, "gifts");
  assert.equal(m1.groups.item, "speaker for DJ");

  const m2 = matchRule("add tent stakes to the camping list");
  assert.equal(m2.rule, "named_list_add");
  assert.equal(m2.groups.rawName, "camping");
  assert.equal(m2.groups.item, "tent stakes");
});

check("matchRule: 'new list:' and named-list-add do not collide with person_note (Git #3305)", () => {
  assert.equal(matchRule("new list: Camping").rule, "new_list");
  assert.equal(matchRule("gifts list: speaker for DJ").rule, "named_list_add");
  // A real person note still works exactly as before.
  assert.equal(matchRule("dana: had a rough day about the lease").rule, "person_note");
});

check("matchRule: occasional-purchase 'What I Like' list, both real phrasings (Git #3311)", () => {
  const m1 = matchRule("I sometimes get almond butter");
  assert.equal(m1.rule, "occasional_purchase_add");
  assert.equal(m1.groups.item, "almond butter");

  const m2 = matchRule("add cast iron skillet to what I like");
  assert.equal(m2.rule, "occasional_purchase_add");
  assert.equal(m2.groups.item, "cast iron skillet");
});

check("matchRule: 'add X to what I like' does not collide with named_list_add (Git #3311)", () => {
  // No trailing "list" word -- named_list_add's own regexes both require one, so this must
  // resolve to the dedicated occasional-purchase rule, not fall through to named_list_add.
  assert.equal(matchRule("add tent stakes to the camping list").rule, "named_list_add");
  assert.equal(matchRule("add cast iron skillet to what I like").rule, "occasional_purchase_add");
});

check("matchRule: where is X", () => {
  assert.equal(matchRule("where's the drill?").rule, "where_is_thing");
  assert.equal(matchRule("where is my passport").rule, "where_is_thing");
});

check("matchRule: thing location, including 'the' being optional", () => {
  assert.equal(matchRule("the drill is in the garage").rule, "thing_location");
  assert.equal(matchRule("Drill is at home").rule, "thing_location");
});

check("matchRule: aisle memory", () => {
  const m = matchRule("pasta aisle 12 end cap");
  assert.equal(m.rule, "aisle_memory");
  assert.equal(m.groups.item, "pasta");
  assert.equal(m.groups.aisle, 12);
  assert.equal(m.groups.note, "end cap");
});

check("matchRule: real price statements", () => {
  assert.equal(matchRule("chicken breasts are $3.49 now").rule, "log_price");
  assert.equal(matchRule("paid $12 for the detergent at Aldi").rule, "log_price");
});

check("matchRule: grocery add, gated behind an explicit shopping verb", () => {
  const m = matchRule("grab milk, eggs and bread");
  assert.equal(m.rule, "grocery_add");
  assert.deepEqual(m.groups.items, ["milk", "eggs", "bread"]);
  // "add" is deliberately NOT a grocery trigger -- it's already claimed by vehicle_add.
  assert.equal(matchRule("add milk to the list") == null, true);
});

check("matchRule: queue for the next run (Git #3300)", () => {
  const m = matchRule("take the drill to the rental");
  assert.equal(m.rule, "queue_take");
  assert.equal(m.groups.name, "drill");
  assert.equal(m.groups.takeForHouse, "rental");
  assert.equal(matchRule("bring HVAC filter to Rental").rule, "queue_take");
});

check("extractTimerDuration: duration before the word 'timer' (README §112-123 item 3)", () => {
  const t = extractTimerDuration("8 min timer for pasta");
  assert.equal(t.seconds, 480);
  assert.equal(t.label, "pasta");
});

check("extractTimerDuration: 'timer for <duration>' (Shane's own decision-comment example)", () => {
  const t = extractTimerDuration("set a timer for 5 minutes");
  assert.equal(t.seconds, 300);
  assert.equal(t.label, null);
});

check("extractTimerDuration: 'timer for <duration> for <label>'", () => {
  const t = extractTimerDuration("set a timer for 8 minutes for the rice");
  assert.equal(t.seconds, 480);
  assert.equal(t.label, "the rice");
});

check("extractTimerDuration: hours and seconds units", () => {
  assert.equal(extractTimerDuration("1 hour timer").seconds, 3600);
  assert.equal(extractTimerDuration("set a timer for 45 seconds").seconds, 45);
});

check("extractTimerDuration: no real duration stated returns null", () => {
  assert.equal(extractTimerDuration("set a timer"), null);
  assert.equal(extractTimerDuration("check the timer"), null);
});

check("formatDuration: real display shapes", () => {
  assert.equal(formatDuration(480), "8 min");
  assert.equal(formatDuration(45), "45 sec");
  assert.equal(formatDuration(3600), "1 hr");
  assert.equal(formatDuration(5430), "1 hr 30 min");
});

check("matchRule: standalone timer (Git #3307)", () => {
  const m = matchRule("8 min timer for pasta");
  assert.equal(m.rule, "timer_set");
  assert.equal(m.groups.seconds, 480);
  assert.equal(m.groups.label, "pasta");
  assert.equal(matchRule("set a timer for 2 minutes").rule, "timer_set");
  // "timer" with no real duration is a genuine parse miss, same as any other rule -- falls
  // through to the pending inbox untouched.
  assert.equal(matchRule("check the timer"), null);
});

check("matchRule: genuinely ambiguous / unrecognised text matches nothing", () => {
  assert.equal(matchRule("call mom about the thing tomorrow maybe"), null);
  assert.equal(matchRule(""), null);
  assert.equal(matchRule("   "), null);
});

// ---------------------------------------------------------------------------------------------
// Real pantry tracking (Git #3308) -- absolute "I have", additive "bought", depleting "used
// the last of".
// ---------------------------------------------------------------------------------------------

check("matchRule: pantry_have, an absolute real quantity", () => {
  const m = matchRule("I have 2 lbs of chicken breasts");
  assert.equal(m.rule, "pantry_have");
  assert.deepEqual(m.groups, { quantity: 2, unit: "lbs", name: "chicken breasts" });
});

check("matchRule: pantry_bought, an additive real restock", () => {
  const m = matchRule("bought 3 cans of diced tomatoes");
  assert.equal(m.rule, "pantry_bought");
  assert.deepEqual(m.groups, { quantity: 3, unit: "cans", name: "diced tomatoes" });
});

check("matchRule: pantry_used_last, real depletion", () => {
  assert.equal(matchRule("used the last of the rosemary").rule, "pantry_used_last");
  assert.deepEqual(matchRule("used the last of the rosemary").groups, { name: "rosemary" });
  // "the"/"my" are both optional -- "used the last of rosemary" (no article) still resolves.
  assert.deepEqual(matchRule("used the last of rosemary").groups, { name: "rosemary" });
});

check("matchRule: pantry_have requires a real number and unit word before 'of' -- a bare 'I have X' is NOT claimed here (false-positive guard: 'I have 2 hours'/'I have 2 kids' fall through untouched)", () => {
  assert.equal(matchRule("I have 2 hours") == null, true);
  assert.equal(matchRule("I have a headache") == null, true);
});

console.log(`\n${passed}/${passed} passed`);
