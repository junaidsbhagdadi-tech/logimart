import { Region } from '@prisma/client';

/**
 * Derive the billing region from an Indian PIN code using the postal-zone rules
 * (first digit), refined for the North-East. Works for ANY valid pincode even
 * when the city isn't in the directory.
 *
 *  1,2 → North   3,4 → West   5,6 → South   7 → East / North-East   8 → East
 */
export function regionFromPincode(pin: string): Region | null {
  if (!pin || !/^\d{6}$/.test(pin)) return null;
  const d = pin[0];
  switch (d) {
    case '1':
    case '2':
      return Region.NORTH;
    case '3':
    case '4':
      return Region.WEST;
    case '5':
    case '6':
      return Region.SOUTH;
    case '7':
      // North-East states: Assam 78, Arunachal/Nagaland/Manipur/Mizoram/Tripura 79,
      // Meghalaya 793-794, Sikkim 737. Rest of '7' (WB/Odisha) is East.
      if (pin.startsWith('78') || pin.startsWith('79') || pin.startsWith('737')) return Region.NORTHEAST;
      return Region.EAST;
    case '8':
      return Region.EAST;
    default:
      return null;
  }
}
