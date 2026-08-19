import { IsBoolean, IsEmail, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** Xpresion "Personal Information" parity — most fields optional. */
export class CreateClientDto {
  @IsString() @MinLength(2) legalName!: string; // Name *
  @IsOptional() @IsString() accountCode?: string; // Code (auto if omitted)
  @IsOptional() @IsString() gstin?: string; // GST No.
  @IsOptional() @IsString() pan?: string; // PAN No.
  @IsOptional() @IsString() addressLine?: string; // Address1
  @IsOptional() @IsString() addressLine2?: string; // Address2
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPerson?: string; // Contact Person
  @IsOptional() @IsString() contactPhone?: string; // Mobile *
  @IsOptional() @IsEmail() contactEmail?: string; // Email ID *
  @IsOptional() @IsString() tel1?: string;
  @IsOptional() @IsString() tel2?: string;
  @IsOptional() @IsString() fax?: string;
  @IsOptional() @IsString() billingState?: string; // Customer Billing State *
  @IsOptional() @IsString() serviceCentre?: string; // Service Centre *
  @IsOptional() @IsString() origin?: string; // Origin *
  @IsOptional() @IsISO8601() startDate?: string; // Start Date *
  @IsOptional() @IsString() aadhaarNo?: string;
  @IsOptional() @IsISO8601() dobAadhaar?: string; // DOB On Aadhar
  @IsOptional() @IsString() passportNo?: string;
  @IsOptional() @IsString() tanNo?: string;
  @IsOptional() @IsString() invoiceFormat?: string;
  @IsOptional() @IsString() customerType?: string; // Customer | Agent
  @IsOptional() @IsString() registerType?: string; // Registered | Un Registered | B2B | B2C
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsInt() @Min(0) creditDays?: number;
  @IsOptional() @IsBoolean() isOneTime?: boolean;
  @IsOptional() @IsBoolean() isCash?: boolean;
}

export class UpdateClientDto {
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() pan?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() addressLine?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() tel1?: string;
  @IsOptional() @IsString() tel2?: string;
  @IsOptional() @IsString() fax?: string;
  @IsOptional() @IsString() billingState?: string;
  @IsOptional() @IsString() serviceCentre?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsString() aadhaarNo?: string;
  @IsOptional() @IsISO8601() dobAadhaar?: string;
  @IsOptional() @IsString() passportNo?: string;
  @IsOptional() @IsString() tanNo?: string;
  @IsOptional() @IsString() invoiceFormat?: string;
  @IsOptional() @IsString() customerType?: string;
  @IsOptional() @IsString() registerType?: string;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsInt() @Min(0) creditDays?: number;
  @IsOptional() @IsBoolean() isCash?: boolean;
}
