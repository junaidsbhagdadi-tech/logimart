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

  @IsOptional() @IsString() manualAwb?: string; // pre-assigned AWB for a manually-booked shipment

  @IsEnum(ServiceMode)
  serviceMode!: ServiceMode;

  @IsOptional() @IsInt() originHubId?: number; // optional — direct city-to-city lanes skip hubs
  @IsOptional() @IsInt() destHubId?: number;
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

  // ---- shipper (sender) — separate party from the billing customer ----
  @IsOptional() @IsString() shipperName?: string;
  @IsOptional() @IsString() shipperContact?: string;
  @IsOptional() @IsString() shipperAddress1?: string;
  @IsOptional() @IsString() shipperAddress2?: string;
  @IsOptional() @IsString() shipperPincode?: string;
  @IsOptional() @IsString() shipperCity?: string;
  @IsOptional() @IsString() shipperState?: string;
  @IsOptional() @IsString() shipperPhone?: string;
  @IsOptional() @IsString() shipperMobile?: string;
  @IsOptional() @IsString() shipperEmail?: string;
  @IsOptional() @IsString() shipperCountry?: string;
  @IsOptional() @IsString() shipperIec?: string;
  @IsOptional() @IsString() shipperGstin?: string;
  @IsOptional() @IsString() shipperDocType?: string;
  @IsOptional() @IsString() shipperDocNo?: string;
  @IsOptional() @IsString() originLocation?: string;

  // ---- consignee extras ----
  @IsOptional() @IsString() consigneeContact?: string;
  @IsOptional() @IsString() consigneeState?: string;
  @IsOptional() @IsString() consigneeCountry?: string;
  @IsOptional() @IsString() consigneeIec?: string;
  @IsOptional() @IsString() consigneeDocType?: string;
  @IsOptional() @IsString() consigneeDocNo?: string;

  // ---- services extras ----
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsNumber() shipmentValue?: number;
  @IsOptional() @IsBoolean() isCommercial?: boolean;
  @IsOptional() @IsBoolean() isMedical?: boolean;
  @IsOptional() @IsBoolean() apptDelivery?: boolean;
  @IsOptional() @IsString() referenceNo?: string;

  // ---- FTL trip details (optional) ----
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsString() ftlVehicleType?: string;
  @IsOptional() @IsISO8601() departureAt?: string;
  @IsOptional() @IsISO8601() arrivalAt?: string;

  @IsOptional() @IsNumber() manualFreight?: number; // ad-hoc/one-time agreed freight

  // ---- payment terms ----
  @IsOptional() @IsEnum(PaymentTerm) paymentTerm?: PaymentTerm; // PREPAID (default) | TO_PAY
  @IsOptional() @IsNumber() freightToCollect?: number;          // amount to collect from consignee (To-Pay)

  // ---- services + accessorial charges ----
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() docType?: string; // DOX | NDOX
  @IsOptional() @IsNumber() chargeWeight?: number;
  @IsOptional() @IsArray() charges?: { code: string; name: string; amount: number }[];

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
