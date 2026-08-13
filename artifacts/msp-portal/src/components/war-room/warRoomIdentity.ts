/**
 * Real customer/tenant identity for the War Room prelude (#315).
 *
 * The prelude used to hardcode the Claude Design prototype's demo org name
 * ("Northline Health") in place of the actual logged-in customer's company
 * name. `war-room.tsx` fetches the real name from `GET /portal/dashboard`
 * (`tenantsTable.customerName`) and passes it down as `v.customerName`;
 * this resolves what the prelude header actually renders.
 */
export function resolvePreludeCustomerName(customerName: string | null | undefined): string {
  return customerName && customerName.trim().length > 0 ? customerName : "Your organization";
}
