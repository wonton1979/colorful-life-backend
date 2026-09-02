import { z } from "zod";

// Deliberately accepts the standard UK postcode forms while leaving detailed
// address validation to the provider.
const ukPostcodePattern = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

export const AddressLookupQuerySchema = z.object({
  postcode: z.string().trim().min(1, { message: "postcode cannot be empty" })
    .transform((value) => value.toUpperCase().replace(/\s+/g, " "))
    .refine((value) => ukPostcodePattern.test(value), { message: "Invalid UK postcode" }),
});
