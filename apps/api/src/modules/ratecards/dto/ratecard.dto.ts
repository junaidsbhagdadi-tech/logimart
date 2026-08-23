import { IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ServiceMode } from '@prisma/client';

export class CreateRateCardDto {
  @IsInt() clientId!: number;
  @IsString() originZone!: string;
  @IsString() destZone!: string;
  @IsEnum(ServiceMode) serviceMode!: ServiceMode;

  @IsNumber() @Min(0) perKgRate!: number;
  @IsOptional() @IsNumber() @Min(0) minCharge?: number;
  @IsOptional() @IsNumber() @Min(0) fuelPct?: number;

  // surcharges
  @IsOptional() @IsNumber() @Min(0) fovPct?: number;
  @IsOptional() @IsNumber() @Min(0) fovMin?: number;
  @IsOptional() @IsNumber() @Min(0) odaFlat?: number;
  @IsOptional() @IsNumber() @Min(0) odaPerKg?: number;
  @IsOptional() @IsNumber() @Min(0) odaMin?: number;
  @IsOptional() @IsNumber() @Min(0) docketCharge?: number;
  @IsOptional() @IsNumber() @Min(0) handlingCharge?: number;

  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

export class CreateFtlRateDto {
  @IsOptional() @IsInt() clientId?: number;
  @IsString() originZone!: string;
  @IsString() destZone!: string;
  @IsString() vehicleType!: string;
  @IsNumber() @Min(0) flatRate!: number;
  @IsOptional() @IsNumber() @Min(0) fuelPct?: number;
  @IsOptional() @IsNumber() @Min(0) gstPct?: number;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}
