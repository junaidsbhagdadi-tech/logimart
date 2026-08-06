import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ServiceMode, PaymentTerm, DodInstrument } from '@prisma/client';

export class PieceInputDto {
  @IsNumber()
  @IsPositive()
  deadKg!: number;

  @IsOptional() @IsNumber() @Min(0) lengthCm?: number;
  @IsOptional() @IsNumber() @Min(0) widthCm?: number;
  @IsOptional() @IsNumber() @Min(0) heightCm?: number;
}

export class CreateShipmentDto {
  @IsInt()
  clientId!: number;

  @IsEnum(ServiceMode)
  serviceMode!: ServiceMode;

  @IsInt() originHubId!: number;
  @IsInt() destHubId!: number;
  @IsString() originZone!: string;
  @IsString() destZone!: string;
  @IsOptional() @IsString() originPincode?: string; // if set, derives originZone (region)

  // ---- consignee / consignment / compliance (optional) ----
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() consigneePhone?: string;
  @IsOptional() @IsString() consigneeAddress?: string;
  @IsOptional() @IsString() consigneeCity?: string;
  @IsOptional() @IsString() destPincode?: string;
  @IsOptional() @IsBoolean() isOda?: boolean;
  @IsOptional() @IsString() goodsDesc?: string;
  @IsOptional() @IsString() hsnCode?: string;
  @IsOptional() @IsString() consignorGstin?: string;
  @IsOptional() @IsString() consigneeGstin?: string;
  @IsOptional() @IsNumber() declaredValue?: number;
  @IsOptional() @IsString() ewbNo?: string; // e-way bill no. (required when invoice value ≥ ₹50k)

  // ---- FTL trip details (optional) ----
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsString() ftlVehicleType?: string;
  @IsOptional() @IsISO8601() departureAt?: string;
  @IsOptional() @IsISO8601() arrivalAt?: string;

  @IsOptional() @IsNumber() manualFreight?: number; // ad-hoc/one-time agreed freight

  // ---- payment terms ----
  @IsOptional() @IsEnum(PaymentTerm) paymentTerm?: PaymentTerm; // PREPAID (default) | TO_PAY
  @IsOptional() @IsNumber() freightToCollect?: number;          // amount to collect from consignee (To-Pay)

  // ---- DOD (Draft on Delivery) ----
  @IsOptional() @IsBoolean() isDod?: boolean;
  @IsOptional() @IsNumber() dodAmount?: number;
  @IsOptional() @IsEnum(DodInstrument) dodInstrument?: DodInstrument; // CHEQUE | DD

  /** Finance override to book despite a credit hold. */
  @IsOptional() @IsBoolean() overrideCreditHold?: boolean;

  /** One entry per physical box. Length defines pieceCount. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PieceInputDto)
  pieces!: PieceInputDto[];
}
